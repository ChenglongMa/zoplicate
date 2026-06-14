#!/usr/bin/env python3
"""Track Zotero upstream implementation contracts used by Zoplicate.

Zoplicate strongly depends on concrete Zotero source behavior (private APIs,
DOM, merge/duplicate logic). Zotero ships three moving references that can
disagree:

- a released tag (e.g. ``9.0.4``)  -- the BASELINE / truth users actually run,
- the release branch HEAD (``9.0``) -- the BETA / upcoming release,
- ``main``                          -- the DEV radar / future version.

This watcher records, per reference, whether each watched anchor still exists
and whether its body changed, and classifies drift by *which tier* moved:

- release moved  -> ``urgent``   (real, user-facing breakage)
- beta moved     -> ``scheduled`` (will ship next; pre-adapt)
- dev moved      -> ``radar``     (future risk; track, do not chase yet)

Anchor existence is a cheap, deterministic pre-filter only. The expensive part
-- did the *behavioral contract* still hold, and where did relocated logic go --
is delegated to the agent workflow referenced by the upstream skill.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.agent.workflow_state import atomic_write_json, build_paths

DEFAULT_REMOTE_URL = "https://github.com/zotero/zotero.git"

# Tiered references. release = baseline/truth, beta = upcoming, dev = radar.
DEFAULT_RELEASE_SERIES = "9."
DEFAULT_BETA_REF = "9.0"
DEFAULT_DEV_REF = "main"

REF_ROLE_RELEASE = "release"
REF_ROLE_BETA = "beta"
REF_ROLE_DEV = "dev"

# Drift severity by the tier that moved.
SEVERITY_URGENT = "urgent"
SEVERITY_SCHEDULED = "scheduled"
SEVERITY_RADAR = "radar"

ROLE_SEVERITY = {
    REF_ROLE_RELEASE: SEVERITY_URGENT,
    REF_ROLE_BETA: SEVERITY_SCHEDULED,
    REF_ROLE_DEV: SEVERITY_RADAR,
}
SEVERITY_RANK = {SEVERITY_RADAR: 0, SEVERITY_SCHEDULED: 1, SEVERITY_URGENT: 2}

WATCH_TARGETS_REL = ".workflow/upstream/zotero_watch_targets.json"
CONTRACT_REL = ".workflow/upstream/zotero_upstream_contract.json"
REPORT_REL = ".workflow/upstream/zotero_upstream_report.md"
MILESTONE_REL = ".workflow/milestones"
MILESTONE_INDEX_REL = ".workflow/milestone_index.json"
PROJECT_SNAPSHOT_REL = ".workflow/project_snapshot.json"
DEFAULT_REFERENCE_DIR = ".references/zotero"

# An anchor_kind may name a fallback group so a target survives upstream syntax
# refactors (e.g. arrow-field <-> class-method) without a watchlist edit. The
# body that matters is the same; only the declaration shape changed.
ANCHOR_KIND_FALLBACKS = {
    "class_member": ["class_method", "method_assignment"],
    "function_any": ["function_assignment", "function_declaration", "exported_function"],
}


@dataclass(frozen=True)
class AnchorResult:
    status: str
    source_path: str
    anchor_text: str
    sha256: str
    matched_kind: str = ""
    message: str = ""


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_json_hash(value: Any) -> str:
    return sha256_text(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_targets_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    targets = payload.get("targets", [])
    if not isinstance(targets, list):
        raise ValueError("watch targets payload must contain a targets array")
    normalized: list[dict[str, Any]] = []
    required_fields = {
        "id",
        "upstream_ref_paths",
        "anchor_kind",
        "anchor_pattern",
        "local_dependency_paths",
        "reason",
        "risk_level",
        "recommended_tests",
    }
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("each watch target must be an object")
        missing = sorted(required_fields.difference(target))
        if missing:
            raise ValueError(f"watch target {target.get('id', '<unknown>')} missing fields: {', '.join(missing)}")
        normalized.append(
            {
                "id": str(target["id"]),
                "upstream_ref_paths": sorted(str(path) for path in target.get("upstream_ref_paths", [])),
                "anchor_kind": str(target["anchor_kind"]),
                "anchor_pattern": str(target["anchor_pattern"]),
                "local_dependency_paths": sorted(str(path) for path in target.get("local_dependency_paths", [])),
                "reason": str(target["reason"]),
                "risk_level": str(target["risk_level"]),
                "recommended_tests": sorted(str(path) for path in target.get("recommended_tests", [])),
                # Behavioral contracts: 1-3 natural-language assertions describing
                # WHAT Zoplicate relies on this anchor doing. Order is meaningful,
                # so it is preserved (not sorted).
                "contracts": [str(item) for item in target.get("contracts", [])],
                # Where relocated logic might have gone; seeds one-hop cascade.
                "cascade_hints": [str(item) for item in target.get("cascade_hints", [])],
                "needs_manual_mapping": bool(target.get("needs_manual_mapping", False)),
            }
        )
    return sorted(normalized, key=lambda item: item["id"])


def write_targets(path: Path, targets: list[dict[str, Any]]) -> None:
    atomic_write_json(path, {"schema_version": "1.0", "targets": targets})


def previous_significant(text: str, index: int) -> str:
    index -= 1
    while index >= 0 and text[index].isspace():
        index -= 1
    return text[index] if index >= 0 else ""


def regex_can_start_after(ch: str) -> bool:
    return ch == "" or ch in "([{=,:;!&|?+-*%^~<>"


def find_matching_brace(text: str, open_index: int) -> int:
    depth = 0
    i = open_index
    state = "code"
    quote = ""
    escaped = False
    regex_char_class = False

    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if state == "line_comment":
            if ch == "\n":
                state = "code"
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 1
        elif state == "string":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "code"
        elif state == "regex":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == "[":
                regex_char_class = True
            elif ch == "]":
                regex_char_class = False
            elif ch == "/" and not regex_char_class:
                state = "code"
        else:
            if ch == "/" and nxt == "/":
                state = "line_comment"
                i += 1
            elif ch == "/" and nxt == "*":
                state = "block_comment"
                i += 1
            elif ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False
            elif ch == "/" and regex_can_start_after(previous_significant(text, i)):
                state = "regex"
                escaped = False
                regex_char_class = False
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1

    raise ValueError("matching closing brace not found")


def extract_block(text: str, regex: str, pattern_label: str) -> str:
    match = re.search(regex, text, flags=re.MULTILINE)
    if not match:
        raise ValueError(f"anchor not found: {pattern_label}")
    open_index = text.find("{", match.start(), match.end())
    if open_index == -1:
        raise ValueError(f"anchor has no opening brace: {pattern_label}")
    close_index = find_matching_brace(text, open_index)
    return text[match.start() : close_index + 1].replace("\r\n", "\n").strip() + "\n"


def extract_anchor_single(text: str, anchor_kind: str, anchor_pattern: str) -> str:
    escaped = re.escape(anchor_pattern)
    if anchor_kind == "function_assignment":
        return extract_block(
            text,
            rf"{escaped}\s*=\s*(?:async\s+)?function\b[^\{{]*\{{",
            anchor_pattern,
        )
    if anchor_kind == "exported_function":
        return extract_block(
            text,
            rf"export\s+(?:async\s+)?function\s+{escaped}\s*\([^\)]*\)\s*\{{",
            anchor_pattern,
        )
    if anchor_kind == "function_declaration":
        return extract_block(
            text,
            rf"(?:async\s+)?function\s+{escaped}\s*\([^\)]*\)\s*\{{",
            anchor_pattern,
        )
    if anchor_kind == "class_method":
        return extract_block(text, rf"^\s*(?:async\s+)?{escaped}\s*\([^\)]*\)\s*\{{", anchor_pattern)
    if anchor_kind == "method_assignment":
        return extract_block(
            text,
            rf"^\s*{escaped}\s*=\s*(?:async\s+)?(?:\([^\)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{{",
            anchor_pattern,
        )
    if anchor_kind == "manual":
        raise ValueError("manual targets do not have extractable upstream anchors")
    raise ValueError(f"unsupported anchor_kind: {anchor_kind}")


def anchor_kind_candidates(anchor_kind: str) -> list[str]:
    return ANCHOR_KIND_FALLBACKS.get(anchor_kind, [anchor_kind])


def extract_anchor(text: str, anchor_kind: str, anchor_pattern: str) -> str:
    """Extract the anchor body, tolerating declaration-shape refactors.

    When ``anchor_kind`` names a fallback group (see ``ANCHOR_KIND_FALLBACKS``)
    every candidate shape is tried until one matches, so a method that flips
    between ``name = (a) => {`` and ``name(a) {`` does not read as ``missing``.
    """
    errors: list[str] = []
    for candidate in anchor_kind_candidates(anchor_kind):
        try:
            return extract_anchor_single(text, candidate, anchor_pattern)
        except ValueError as exc:
            errors.append(str(exc))
    raise ValueError("; ".join(errors) if errors else f"anchor not found: {anchor_pattern}")


def extract_anchor_with_kind(text: str, anchor_kind: str, anchor_pattern: str) -> tuple[str, str]:
    """Like :func:`extract_anchor` but also reports which candidate matched."""
    errors: list[str] = []
    for candidate in anchor_kind_candidates(anchor_kind):
        try:
            return extract_anchor_single(text, candidate, anchor_pattern), candidate
        except ValueError as exc:
            errors.append(str(exc))
    raise ValueError("; ".join(errors) if errors else f"anchor not found: {anchor_pattern}")


def extract_target(root: Path, target: dict[str, Any]) -> AnchorResult:
    if target.get("needs_manual_mapping") or target.get("anchor_kind") == "manual":
        return AnchorResult(
            status="manual",
            source_path="",
            anchor_text="",
            sha256="",
            message="manual upstream mapping required",
        )

    messages: list[str] = []
    for rel_path in target["upstream_ref_paths"]:
        source_path = root / rel_path
        if not source_path.exists():
            messages.append(f"{rel_path}: missing")
            continue
        text = source_path.read_text(encoding="utf-8", errors="replace")
        try:
            anchor_text, matched_kind = extract_anchor_with_kind(text, target["anchor_kind"], target["anchor_pattern"])
            return AnchorResult(
                status="ok",
                source_path=rel_path,
                anchor_text=anchor_text,
                sha256=sha256_text(anchor_text),
                matched_kind=matched_kind,
            )
        except ValueError as exc:
            messages.append(f"{rel_path}: {exc}")

    return AnchorResult(
        status="missing",
        source_path="",
        anchor_text="",
        sha256="",
        message="; ".join(messages),
    )


def git_output(cwd: Path | None, args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def infer_role(ref: str) -> str:
    if re.fullmatch(r"\d+\.\d+\.\d+.*", ref):
        return REF_ROLE_RELEASE
    if re.fullmatch(r"\d+\.\d+", ref):
        return REF_ROLE_BETA
    return REF_ROLE_DEV


def resolve_release_tag(remote_url: str, series_prefix: str, *, git_runner=git_output) -> str | None:
    """Return the highest stable tag (``X.Y.Z``) under ``series_prefix``.

    Pre-release tags (``-beta``, ``-rc``) are ignored: the baseline tier must
    track what users actually run, not what is in flight.
    """
    try:
        output = git_runner(None, ["ls-remote", "--tags", "--refs", remote_url])
    except Exception:
        return None
    best: str | None = None
    best_key: tuple[int, ...] | None = None
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        tag = parts[1].removeprefix("refs/tags/")
        if not tag.startswith(series_prefix):
            continue
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", tag)
        if not match:
            continue
        key = tuple(int(part) for part in match.groups())
        if best_key is None or key > best_key:
            best_key = key
            best = tag
    return best


def build_watched_refs(args: argparse.Namespace, remote_url: str, *, git_runner=git_output) -> list[tuple[str, str]]:
    """Resolve the (ref, role) tiers to snapshot.

    Explicit ``--ref``/``--also-ref`` override the tiered defaults; their role
    is inferred from the ref shape. Otherwise the release tier is resolved to
    the latest stable tag, with the release branch as beta and ``main`` as dev.
    """
    explicit = list(getattr(args, "refs", None) or []) + list(getattr(args, "also_refs", None) or [])
    if explicit:
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for ref in explicit:
            if ref not in seen:
                seen.add(ref)
                out.append((ref, infer_role(ref)))
        return out

    tiers: list[tuple[str, str]] = []
    release = getattr(args, "release_ref", None)
    if release is None:
        release = resolve_release_tag(remote_url, getattr(args, "release_series", DEFAULT_RELEASE_SERIES), git_runner=git_runner)
    if release:
        tiers.append((release, REF_ROLE_RELEASE))
    tiers.append((getattr(args, "beta_ref", None) or DEFAULT_BETA_REF, REF_ROLE_BETA))
    tiers.append((getattr(args, "dev_ref", None) or DEFAULT_DEV_REF, REF_ROLE_DEV))

    out = []
    seen = set()
    for ref, role in tiers:
        if ref not in seen:
            seen.add(ref)
            out.append((ref, role))
    return out


def clone_refs(remote_url: str, refs: list[str]) -> tuple[tempfile.TemporaryDirectory[str], dict[str, Path]]:
    temp_dir = tempfile.TemporaryDirectory(prefix="zoplicate-zotero-upstream-")
    base = Path(temp_dir.name)
    ref_dirs: dict[str, Path] = {}
    for ref in refs:
        destination = base / re.sub(r"[^A-Za-z0-9_.-]+", "_", ref)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, remote_url, str(destination)],
            text=True,
            capture_output=True,
            check=True,
        )
        ref_dirs[ref] = destination
    return temp_dir, ref_dirs


def reusable_reference_dir(project_dir: Path, reference_dir: str | None) -> Path | None:
    """Resolve a shared local clone usable as the dev-tier source.

    Single-source policy: the dev/``main`` tier reads the same full clone that
    project MCP uses (``.references/zotero``) instead of a throwaway clone, so
    there is one dev source of truth. Release/beta tiers stay ephemeral
    verification checkouts (you never develop against a frozen tag).
    """
    if not reference_dir:
        return None
    path = Path(reference_dir)
    if not path.is_absolute():
        path = project_dir / path
    path = path.resolve()
    return path if (path / ".git").exists() else None


def collect_snapshots(
    ref_dirs: dict[str, Path],
    targets: list[dict[str, Any]],
    ref_roles: dict[str, str] | None = None,
) -> dict[str, Any]:
    ref_roles = ref_roles or {}
    snapshots: dict[str, Any] = {}
    for ref, root in ref_dirs.items():
        try:
            head = git_output(root, ["rev-parse", "HEAD"])
        except Exception:
            head = "unknown"
        anchors: dict[str, Any] = {}
        for target in targets:
            result = extract_target(root, target)
            anchors[target["id"]] = {
                "status": result.status,
                "source_path": result.source_path,
                "anchor_kind": target["anchor_kind"],
                "anchor_pattern": target["anchor_pattern"],
                "matched_kind": result.matched_kind,
                "sha256": result.sha256,
                "message": result.message,
            }
        snapshots[ref] = {"head": head, "role": ref_roles.get(ref, infer_role(ref)), "anchors": anchors}
    return snapshots


def snapshot_role(ref: str, snapshot: dict[str, Any], ref_roles: dict[str, str]) -> str:
    return ref_roles.get(ref) or snapshot.get("role") or infer_role(ref)


def resolve_baseline_snapshot(
    ref: str,
    role: str,
    old_snapshots: dict[str, Any],
    old_roles_by_ref: dict[str, str],
) -> dict[str, Any] | None:
    """Find the prior snapshot to compare a new (ref, role) against.

    Comparison is by ROLE, not by ref name. A release tag that advances
    (``9.0.4`` -> ``9.0.5``) is a NEW ref name but the SAME release role, so it
    must still be compared against the previous release snapshot -- otherwise
    every release bump silently skips release-tier drift detection.

    Order: exact ref match (cheapest, most precise), then the unique prior
    snapshot carrying the same role. If the role is ambiguous in the old
    contract (more than one ref had it), fall back to no baseline so we don't
    guess wrong.
    """
    if ref in old_snapshots:
        return old_snapshots[ref]
    same_role = [old_snapshots[r] for r, old_role in old_roles_by_ref.items() if old_role == role]
    if len(same_role) == 1:
        return same_role[0]
    return None


def compare_contracts(
    old: dict[str, Any] | None,
    new: dict[str, Any],
    ref_roles: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    if not old:
        return []
    ref_roles = ref_roles or {}
    changes: list[dict[str, Any]] = []
    old_snapshots = old.get("snapshots", {})
    # Map each old ref to the role it played, so a renamed-but-same-role ref
    # (e.g. an advanced release tag) can find its predecessor snapshot.
    old_ref_roles = old.get("ref_roles", {})
    old_roles_by_ref = {
        ref: old_ref_roles.get(ref) or snap.get("role") or infer_role(ref)
        for ref, snap in old_snapshots.items()
    }
    for ref, snapshot in new.get("snapshots", {}).items():
        role = snapshot_role(ref, snapshot, ref_roles)
        old_snapshot = resolve_baseline_snapshot(ref, role, old_snapshots, old_roles_by_ref)
        # No comparable prior snapshot for this role at all (e.g. the very first
        # time a tier is introduced). Its first snapshot establishes a baseline;
        # it is not drift, so skip it to avoid a flood of false "missing -> ok".
        if old_snapshot is None:
            continue
        old_anchors = old_snapshot.get("anchors", {})
        for target_id, anchor in snapshot.get("anchors", {}).items():
            old_anchor = old_anchors.get(target_id)
            # The only behavioral signals are existence (status) and body
            # (sha256). anchor_kind / anchor_pattern / matched_kind / source_path
            # are locator metadata: editing them in the watchlist (e.g. widening
            # anchor_kind to a fallback group) must NOT register as upstream
            # drift when the matched body and status are unchanged.
            old_signal = (
                ((old_anchor or {}).get("status", "missing")),
                ((old_anchor or {}).get("sha256", "")),
            )
            new_signal = (anchor.get("status", "missing"), anchor.get("sha256", ""))
            if old_anchor is not None and old_signal == new_signal:
                continue
            if old_anchor != anchor:
                changes.append(
                    {
                        "ref": ref,
                        "role": role,
                        "severity": ROLE_SEVERITY.get(role, SEVERITY_RADAR),
                        "target_id": target_id,
                        "old_sha256": (old_anchor or {}).get("sha256", ""),
                        "new_sha256": anchor.get("sha256", ""),
                        "old_status": (old_anchor or {}).get("status", "missing"),
                        "new_status": anchor.get("status", "missing"),
                        "source_path": anchor.get("source_path", ""),
                    }
                )
    return changes


def detect_baseline_advances(old: dict[str, Any] | None, new: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect tiers whose ref NAME advanced while keeping the same role.

    A release tag bump (``9.0.4`` -> ``9.0.5``) is not drift, but it IS a
    notable event: the version users run has moved. Surfacing it makes the
    "adapt to the released version" baseline auditable instead of silent.
    """
    if not old:
        return []
    old_snapshots = old.get("snapshots", {})
    old_ref_roles = old.get("ref_roles", {})
    old_roles_by_ref = {
        ref: old_ref_roles.get(ref) or snap.get("role") or infer_role(ref)
        for ref, snap in old_snapshots.items()
    }
    new_ref_roles = new.get("ref_roles", {})
    advances: list[dict[str, Any]] = []
    for ref, snap in new.get("snapshots", {}).items():
        if ref in old_snapshots:
            continue
        role = new_ref_roles.get(ref) or snap.get("role") or infer_role(ref)
        prior = [r for r, old_role in old_roles_by_ref.items() if old_role == role]
        if len(prior) == 1:
            advances.append({"role": role, "old_ref": prior[0], "new_ref": ref})
    return advances


def max_severity(changes: list[dict[str, Any]]) -> str:
    best = SEVERITY_RADAR
    for change in changes:
        severity = change.get("severity", SEVERITY_RADAR)
        if SEVERITY_RANK.get(severity, 0) > SEVERITY_RANK.get(best, 0):
            best = severity
    return best


def parse_diff(diff_text: str) -> tuple[dict[str, str], set[str], dict[str, list[str]]]:
    renames: dict[str, str] = {}
    deleted: set[str] = set()
    additions: dict[str, list[str]] = {}
    current_old = ""
    current_new = ""
    rename_from = ""
    is_deleted = False

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            if current_new and is_deleted:
                deleted.add(current_new if current_new != "/dev/null" else current_old)
            parts = line.split()
            current_old = parts[2][2:] if len(parts) > 2 and parts[2].startswith("a/") else ""
            current_new = parts[3][2:] if len(parts) > 3 and parts[3].startswith("b/") else current_old
            rename_from = ""
            is_deleted = False
            continue
        if line.startswith("deleted file mode"):
            is_deleted = True
            continue
        if line.startswith("rename from "):
            rename_from = line.removeprefix("rename from ").strip()
            continue
        if line.startswith("rename to "):
            rename_to = line.removeprefix("rename to ").strip()
            if rename_from:
                renames[rename_from] = rename_to
            current_new = rename_to
            continue
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+") and not line.startswith("+++"):
            additions.setdefault(current_new, []).append(line[1:])

    if current_new and is_deleted:
        deleted.add(current_new if current_new != "/dev/null" else current_old)
    return renames, deleted, additions


def slugify(value: str, max_length: int = 72) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return (value or "manual")[:max_length].strip("-")


def chrome_url_to_upstream_path(value: str) -> str:
    if value.startswith("chrome://zotero/content/"):
        return "chrome/content/zotero/" + value.removeprefix("chrome://zotero/content/")
    return ""


def detect_zotero_facing_additions(path: str, lines: list[str]) -> list[dict[str, Any]]:
    detected: list[dict[str, Any]] = []
    for line in lines:
        chrome_match = re.search(r"ChromeUtils\.importESModule\([\"'](chrome://zotero/content/[^\"']+)[\"']\)", line)
        if chrome_match:
            chrome_url = chrome_match.group(1)
            upstream_path = chrome_url_to_upstream_path(chrome_url)
            detected.append(
                {
                    "id": f"manual-{slugify(upstream_path or chrome_url)}",
                    "upstream_ref_paths": [upstream_path] if upstream_path else [],
                    "anchor_pattern": chrome_url,
                    "reason": f"New Zotero chrome module dependency detected in {path}.",
                }
            )

        private_match = re.search(r"Zotero\.[A-Za-z0-9_$.]+\.prototype\.[A-Za-z0-9_$]+|Zotero\.[A-Za-z0-9_$.]+", line)
        if private_match and ("prototype" in private_match.group(0) or "._" in private_match.group(0)):
            symbol = private_match.group(0)
            detected.append(
                {
                    "id": f"manual-{slugify(symbol)}",
                    "upstream_ref_paths": [],
                    "anchor_pattern": symbol,
                    "reason": f"New Zotero private API dependency detected in {path}.",
                }
            )

        selector_match = re.search(r"(getElementById|querySelector)\([\"']([^\"']*(?:zotero-|item-message-pane|duplicates-merge-pane)[^\"']*)[\"']\)", line)
        if selector_match:
            selector = selector_match.group(2)
            detected.append(
                {
                    "id": f"manual-dom-{slugify(selector)}",
                    "upstream_ref_paths": [],
                    "anchor_pattern": selector,
                    "reason": f"New Zotero DOM dependency detected in {path}.",
                }
            )

        patch_match = re.search(r"patchMethod\(\s*([^,]+),\s*[\"']([^\"']+)[\"']", line)
        if patch_match:
            symbol = f"{patch_match.group(1).strip()}.{patch_match.group(2)}"
            detected.append(
                {
                    "id": f"manual-patch-{slugify(symbol)}",
                    "upstream_ref_paths": [],
                    "anchor_pattern": symbol,
                    "reason": f"New monkey-patch target detected in {path}.",
                }
            )

        github_match = re.search(r"github\.com/zotero/zotero/(?:blob|tree)/[^/]+/([^#\\s)]+)", line)
        if github_match:
            upstream_path = github_match.group(1)
            detected.append(
                {
                    "id": f"manual-link-{slugify(upstream_path)}",
                    "upstream_ref_paths": [upstream_path],
                    "anchor_pattern": upstream_path,
                    "reason": f"New Zotero upstream source link detected in {path}.",
                }
            )
    return detected


def sync_watch_targets_from_diff_text(targets: list[dict[str, Any]], diff_text: str) -> tuple[list[dict[str, Any]], bool]:
    renames, deleted, additions = parse_diff(diff_text)
    changed = False
    next_targets: list[dict[str, Any]] = []

    for target in targets:
        updated = dict(target)
        local_paths = list(updated.get("local_dependency_paths", []))
        remapped = [renames.get(path, path) for path in local_paths if path not in deleted]
        if remapped != local_paths:
            changed = True
        updated["local_dependency_paths"] = sorted(set(remapped))
        if updated["local_dependency_paths"]:
            next_targets.append(updated)
        else:
            changed = True

    existing_ids = {target["id"] for target in next_targets}
    for path, lines in additions.items():
        if not path.startswith((".claude", "src/", "typings/", "addon/", "tests/")):
            continue
        for detected in detect_zotero_facing_additions(path, lines):
            target_id = detected["id"]
            if target_id in existing_ids:
                for target in next_targets:
                    if target["id"] == target_id and path not in target["local_dependency_paths"]:
                        target["local_dependency_paths"] = sorted([*target["local_dependency_paths"], path])
                        changed = True
                continue
            next_targets.append(
                {
                    "id": target_id,
                    "upstream_ref_paths": detected["upstream_ref_paths"],
                    "anchor_kind": "manual",
                    "anchor_pattern": detected["anchor_pattern"],
                    "local_dependency_paths": [path],
                    "reason": detected["reason"],
                    "risk_level": "medium",
                    "recommended_tests": [],
                    "contracts": [],
                    "cascade_hints": [],
                    "needs_manual_mapping": True,
                }
            )
            existing_ids.add(target_id)
            changed = True

    return sorted(next_targets, key=lambda item: item["id"]), changed


def next_milestone_id(milestone_index: dict[str, Any], milestones_dir: Path) -> str:
    ids: set[int] = set()
    for entry in milestone_index.get("milestones", []):
        match = re.fullmatch(r"M(\d+)", str(entry.get("id", "")))
        if match:
            ids.add(int(match.group(1)))
    for path in milestones_dir.glob("M*.json"):
        match = re.fullmatch(r"M(\d+)", path.stem)
        if match:
            ids.add(int(match.group(1)))
    return f"M{(max(ids) if ids else 0) + 1:03d}"


def existing_open_upstream_milestone(milestones_dir: Path) -> str | None:
    for path in sorted(milestones_dir.glob("M*.json")):
        try:
            milestone = load_json(path)
        except Exception:
            continue
        if milestone.get("status") in {"next", "planned", "draft"} and milestone.get("upstream_watch"):
            return str(milestone["id"])
    return None


def impacted_targets(targets: list[dict[str, Any]], changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = {change["target_id"] for change in changes}
    manual_ids = {target["id"] for target in targets if target.get("needs_manual_mapping")}
    wanted = ids | manual_ids
    return [target for target in targets if target["id"] in wanted]


def severity_by_target(changes: list[dict[str, Any]]) -> dict[str, str]:
    """Highest severity seen per target across all refs."""
    result: dict[str, str] = {}
    for change in changes:
        target_id = change["target_id"]
        severity = change.get("severity", SEVERITY_RADAR)
        if target_id not in result or SEVERITY_RANK.get(severity, 0) > SEVERITY_RANK.get(result[target_id], 0):
            result[target_id] = severity
    return result


def build_report(
    *,
    generated_at: str,
    remote_url: str,
    watched: list[tuple[str, str]],
    old_contract_exists: bool,
    watchlist_changed: bool,
    changes: list[dict[str, Any]],
    targets: list[dict[str, Any]],
    milestone_id: str | None,
    report_rel: str,
    contract_rel: str,
    targets_rel: str,
    milestone_dir_rel: str,
    baseline_advances: list[dict[str, Any]] | None = None,
) -> str:
    baseline_advances = baseline_advances or []
    overall = max_severity(changes) if changes else SEVERITY_RADAR
    refs_label = ", ".join(f"{ref} ({role})" for ref, role in watched)
    lines = [
        "# Zotero Upstream Watch Report",
        "",
        f"- Generated: `{generated_at}`",
        f"- Remote: `{remote_url}`",
        f"- Refs: `{refs_label}`",
        f"- Watchlist changed: `{'yes' if watchlist_changed else 'no'}`",
        f"- Baseline existed: `{'yes' if old_contract_exists else 'no'}`",
        f"- Overall severity: `{overall if changes else 'none'}`",
        f"- Draft milestone: `{milestone_id or 'none'}`",
        "",
    ]

    if baseline_advances:
        lines.extend(["## Baseline Advances", ""])
        for advance in baseline_advances:
            lines.append(
                f"- `{advance['role']}` tier advanced `{advance['old_ref']}` -> `{advance['new_ref']}`; "
                "anchors compared against the prior tier snapshot (not skipped)."
            )
        lines.append("")

    manual_targets = [target for target in targets if target.get("needs_manual_mapping")]
    if not old_contract_exists:
        lines.extend(
            [
                "## Status",
                "",
                "Baseline initialized. No compatibility milestone was generated for the first snapshot.",
                "",
            ]
        )
    elif not changes and not watchlist_changed and not manual_targets:
        lines.extend(["## Status", "", "No watched Zotero upstream anchors changed.", ""])
    else:
        lines.extend(
            [
                "## Tier Severity Legend",
                "",
                "- `urgent` (release tag): users are affected now -- fix and adapt.",
                "- `scheduled` (release branch / beta): ships next -- pre-adapt before release.",
                "- `radar` (main / dev): future risk only -- track, do not chase yet.",
                "",
                "## Changed Targets",
                "",
            ]
        )
        if changes:
            lines.extend(
                [
                    "| Ref | Role | Severity | Target | Old | New | Status | Source |",
                    "| --- | --- | --- | --- | --- | --- | --- | --- |",
                ]
            )
            ordered = sorted(
                changes,
                key=lambda change: (-SEVERITY_RANK.get(change.get("severity", SEVERITY_RADAR), 0), change["target_id"]),
            )
            for change in ordered:
                old_sha = (change["old_sha256"] or change["old_status"])[:12]
                new_sha = (change["new_sha256"] or change["new_status"])[:12]
                lines.append(
                    f"| `{change['ref']}` | `{change.get('role', '')}` | `{change.get('severity', '')}` | "
                    f"`{change['target_id']}` | `{old_sha}` | `{new_sha}` | "
                    f"`{change['old_status']} -> {change['new_status']}` | `{change['source_path']}` |"
                )
            lines.append("")
        else:
            lines.extend(["No upstream anchor hashes changed.", ""])

        # Anchors that vanished get explicit triage guidance: a missing anchor is
        # only a real removal if the symbol cannot be found anywhere upstream.
        missing_changes = [change for change in changes if change.get("new_status") == "missing"]
        if missing_changes:
            lines.extend(["## Missing-Anchor Triage", ""])
            for change in missing_changes:
                lines.append(
                    f"- `{change['target_id']}` on `{change['ref']}` ({change.get('severity', '')}): "
                    "grep the symbol across the upstream clone. Still present => declaration-shape refactor "
                    "(widen anchor_kind / add fallback). Absent => true removal/rename "
                    "(set needs_manual_mapping=true and trace the relocated logic)."
                )
            lines.append("")

        contract_targets = [
            target
            for target in impacted_targets(targets, changes)
            if target.get("contracts")
        ]
        if contract_targets:
            lines.extend(["## Behavioral Contracts To Verify", ""])
            for target in contract_targets:
                lines.append(f"- `{target['id']}`:")
                for contract in target["contracts"]:
                    lines.append(f"  - {contract}")
            lines.append("")

        if manual_targets:
            lines.extend(["## Manual Mappings", ""])
            for target in manual_targets:
                lines.append(f"- `{target['id']}` from `{', '.join(target['local_dependency_paths'])}` needs upstream mapping.")
            lines.append("")

    lines.extend(
        [
            "## Artifacts",
            "",
            f"- Watchlist: `{targets_rel}`",
            f"- Contract: `{contract_rel}`",
            f"- Report: `{report_rel}`",
            f"- Draft milestone: `{f'{milestone_dir_rel}/{milestone_id}.json' if milestone_id else 'none'}`",
            "",
            "## Next Steps",
            "",
            "1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.",
            "2. For each changed target, verify the behavioral contracts on the release tier before touching code.",
            "3. `urgent`/`scheduled` drift: run `/upstream-pr-milestone pr=<pr> mode=review`, then `/milestone-tdd milestone=M###`.",
            "4. `radar`-only drift: track relocated logic via cascade hints; do not modify release-targeting product code yet.",
            "",
        ]
    )
    return "\n".join(lines)


def build_milestone(
    milestone_id: str,
    *,
    generated_at: str,
    latest_accepted: str,
    changed_targets: list[dict[str, Any]],
    changes: list[dict[str, Any]],
    watchlist_changed: bool,
    report_rel: str,
    contract_rel: str,
    targets_rel: str,
) -> dict[str, Any]:
    target_ids = [target["id"] for target in changed_targets]
    tests = sorted({test for target in changed_targets for test in target.get("recommended_tests", [])})
    manual_targets = [target["id"] for target in changed_targets if target.get("needs_manual_mapping")]
    overall = max_severity(changes) if changes else SEVERITY_RADAR
    per_target_severity = severity_by_target(changes)
    radar_only = overall == SEVERITY_RADAR

    if radar_only:
        title = "Zotero upstream drift watch (dev radar)"
        status = "planned"
        goal = (
            "Track Zotero dev (main) drift in watched anchors. Released/beta versions are NOT yet affected; "
            "do not change release-targeting product code -- record where relocated logic moved for future adaptation."
        )
    else:
        title = "Zotero upstream compatibility fix (release-affecting)"
        status = "next"
        goal = (
            "Adapt Zoplicate to Zotero upstream changes that affect the released or upcoming (beta) version's "
            "duplicate detection, merge, patch, or UI integration contracts."
        )

    acceptance = [
        f"Review {report_rel} and classify every changed target by tier severity (urgent/scheduled/radar).",
    ]

    # Per-target behavioral contract verification -- the core of the milestone.
    contract_lines: list[str] = []
    for target in changed_targets:
        contracts = target.get("contracts", [])
        if not contracts:
            continue
        severity = per_target_severity.get(target["id"], SEVERITY_RADAR)
        contract_lines.append(
            f"Verify {target['id']} ({severity}) contracts still hold on the release tier: " + " | ".join(contracts)
        )
    acceptance.extend(contract_lines)

    if radar_only:
        acceptance.extend(
            [
                "Do NOT modify release-targeting product code; the released/beta versions are unaffected.",
                "For each dev-only change, trace where the relocated logic went (one hop) and record new watch targets.",
                "Run uv run python scripts/ci/check_zotero_upstream.py --check-only to refresh radar status.",
                "Run uv run python scripts/ci/check_stop.py.",
            ]
        )
    else:
        acceptance.extend(
            [
                "Update only the Zoplicate code paths whose verified contract actually broke on release/beta.",
                "For each broken contract, trace where the upstream logic relocated (one hop) and update dependent local methods.",
                "Run uv run python scripts/ci/check_zotero_upstream.py --check-only after fixes.",
                "Run uv run python scripts/ci/check_stop.py.",
                "Run npx tsc --noEmit.",
            ]
        )
        if tests:
            acceptance.append("Run targeted tests: " + " ".join(tests) + ".")
        else:
            acceptance.append("Add or identify the smallest relevant regression test for each broken contract.")

    if manual_targets:
        acceptance.append("Resolve manual upstream mappings: " + ", ".join(manual_targets) + ".")

    return {
        "id": milestone_id,
        "title": title,
        "phase": "Maintenance - Zotero Upstream Compatibility",
        "status": status,
        "depends_on": [latest_accepted] if latest_accepted else [],
        "goal": goal,
        "in_scope": [
            "Inspect changed upstream watch targets: " + (", ".join(target_ids) if target_ids else "watchlist metadata"),
            "Verify the behavioral contracts of each changed target on the release tier.",
            "Update Zoplicate compatibility code and tests only where a release/beta contract actually broke.",
            "Refresh upstream contract snapshots after compatibility work.",
        ],
        "out_of_scope": [
            "Unrelated feature work",
            "Broad refactors not required by upstream compatibility",
            "Chasing dev-only (radar) drift with product code changes",
            "Changing release metadata unless Zotero compatibility bounds actually change",
        ],
        "acceptance": acceptance,
        "upstream_watch": {
            "detected_at_utc": generated_at,
            "severity": overall,
            "changed_targets": target_ids,
            "target_severity": per_target_severity,
            "watchlist_changed": watchlist_changed,
            "report_path": report_rel,
            "contract_path": contract_rel,
            "watch_targets_path": targets_rel,
        },
    }


def update_milestone_state(
    project_dir: Path,
    milestone: dict[str, Any],
    *,
    report_rel: str,
    contract_rel: str,
    targets_rel: str,
) -> None:
    index_path = project_dir / MILESTONE_INDEX_REL
    snapshot_path = project_dir / PROJECT_SNAPSHOT_REL
    milestones_dir = project_dir / MILESTONE_REL
    milestone_id = milestone["id"]

    index = load_json(index_path)
    entries = [entry for entry in index.get("milestones", []) if entry.get("id") != milestone_id]
    entries.append(
        {
            "id": milestone_id,
            "title": milestone["title"],
            "phase": milestone["phase"],
            "status": milestone["status"],
            "depends_on": milestone["depends_on"],
            "goal": milestone["goal"],
            "in_scope": milestone["in_scope"],
            "out_of_scope": milestone["out_of_scope"],
            "acceptance": milestone["acceptance"],
        }
    )
    entries.sort(key=lambda entry: int(str(entry["id"])[1:]) if re.fullmatch(r"M\d+", str(entry["id"])) else 9999)
    index["milestones"] = entries
    atomic_write_json(index_path, index)

    atomic_write_json(milestones_dir / f"{milestone_id}.json", milestone)

    severity = milestone.get("upstream_watch", {}).get("severity", SEVERITY_RADAR)
    snapshot = load_json(snapshot_path)
    snapshot["current_target_milestone"] = milestone_id
    # Radar-only drift must not advance the active product status to "next";
    # it is tracked, not in-flight work.
    snapshot["current_status"] = "planned"
    snapshot["last_updated_utc"] = utc_now()
    risks = snapshot.setdefault("open_risks_summary", [])
    if severity == SEVERITY_RADAR:
        risk = (
            f"{milestone_id} is a Zotero dev (main) radar watch; released/beta unaffected. "
            f"Track relocated logic via {report_rel}; do not change product code yet."
        )
    else:
        risk = (
            f"{milestone_id} flags release/beta-affecting Zotero upstream drift ({severity}); "
            f"verify contracts in {report_rel} before implementation."
        )
    if risk not in risks:
        risks.append(risk)
    atomic_write_json(snapshot_path, snapshot)


def build_contract(
    *,
    generated_at: str,
    remote_url: str,
    watched: list[tuple[str, str]],
    targets: list[dict[str, Any]],
    snapshots: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": "1.1",
        "generated_at_utc": generated_at,
        "remote_url": remote_url,
        "watched_refs": [ref for ref, _ in watched],
        "ref_roles": {ref: role for ref, role in watched},
        "watch_targets_hash": stable_json_hash(targets),
        "watch_targets": targets,
        "snapshots": snapshots,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check Zotero upstream contract drift.")
    parser.add_argument("--project-dir", default=None)
    parser.add_argument("--remote-url", default=DEFAULT_REMOTE_URL)
    parser.add_argument("--ref", dest="refs", action="append", default=None)
    parser.add_argument("--also-ref", dest="also_refs", action="append", default=None)
    parser.add_argument("--release-ref", default=None, help="Pin the release/baseline tag instead of auto-resolving.")
    parser.add_argument("--release-series", default=DEFAULT_RELEASE_SERIES, help="Tag prefix for release-tier resolution.")
    parser.add_argument("--beta-ref", default=None, help="Release-branch (beta) ref. Defaults to the current series branch.")
    parser.add_argument("--dev-ref", default=None, help="Dev (radar) ref. Defaults to main.")
    parser.add_argument(
        "--reference-dir",
        default=None,
        help="Reuse this local clone as the dev-tier source (single-source policy). Defaults to no reuse.",
    )
    parser.add_argument("--watch-targets", default=WATCH_TARGETS_REL)
    parser.add_argument("--contract", default=CONTRACT_REL)
    parser.add_argument("--report", default=REPORT_REL)
    parser.add_argument("--milestone-dir", default=MILESTONE_REL)
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--sync-watch-targets-from-pr-diff", default=None)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    paths = build_paths(args.project_dir)
    project_dir = paths.project_dir
    generated_at = utc_now()

    watch_targets_path = project_dir / args.watch_targets
    contract_path = project_dir / args.contract
    report_path = project_dir / args.report
    targets_payload = load_json(watch_targets_path)
    targets = normalize_targets_payload(targets_payload)

    watchlist_changed_by_diff = False
    if args.sync_watch_targets_from_pr_diff:
        diff_text = Path(args.sync_watch_targets_from_pr_diff).read_text(encoding="utf-8")
        targets, watchlist_changed_by_diff = sync_watch_targets_from_diff_text(targets, diff_text)
        if args.update and watchlist_changed_by_diff:
            write_targets(watch_targets_path, targets)

    old_contract = load_json(contract_path) if contract_path.exists() else None

    if not shutil.which("git"):
        raise RuntimeError("git is required to check Zotero upstream contracts")

    watched = build_watched_refs(args, args.remote_url)
    ref_roles = {ref: role for ref, role in watched}

    # Dev-tier single-source reuse: read the shared .references clone instead of
    # a throwaway clone of main, when available.
    reuse_dir = reusable_reference_dir(project_dir, getattr(args, "reference_dir", None))
    reuse_dirs: dict[str, Path] = {}
    refs_to_clone: list[str] = []
    for ref, role in watched:
        if reuse_dir is not None and role == REF_ROLE_DEV:
            reuse_dirs[ref] = reuse_dir
        else:
            refs_to_clone.append(ref)

    temp_dir, ref_dirs = clone_refs(args.remote_url, refs_to_clone)
    try:
        all_dirs = {**ref_dirs, **reuse_dirs}
        snapshots = collect_snapshots(all_dirs, targets, ref_roles)
    finally:
        temp_dir.cleanup()

    new_contract = build_contract(
        generated_at=generated_at,
        remote_url=args.remote_url,
        watched=watched,
        targets=targets,
        snapshots=snapshots,
    )

    changes = compare_contracts(old_contract, new_contract, ref_roles)
    baseline_advances = detect_baseline_advances(old_contract, new_contract)
    old_hash = (old_contract or {}).get("watch_targets_hash", "")
    watchlist_changed = bool(old_contract and old_hash != new_contract["watch_targets_hash"]) or watchlist_changed_by_diff
    old_contract_exists = old_contract is not None
    # A milestone is warranted only by real upstream movement (anchor changes) or
    # an unresolved manual mapping. A pure watchlist metadata edit (adding
    # contracts, widening anchor_kind) refreshes the contract/report but must not
    # spawn a product milestone.
    has_manual = any(target.get("needs_manual_mapping") for target in targets)
    needs_milestone = old_contract_exists and (bool(changes) or has_manual)

    milestone_id: str | None = None
    if needs_milestone:
        index = load_json(project_dir / MILESTONE_INDEX_REL)
        milestones_dir = project_dir / args.milestone_dir
        milestone_id = existing_open_upstream_milestone(milestones_dir) or next_milestone_id(index, milestones_dir)

    report_text = build_report(
        generated_at=generated_at,
        remote_url=args.remote_url,
        watched=watched,
        old_contract_exists=old_contract_exists,
        watchlist_changed=watchlist_changed,
        changes=changes,
        baseline_advances=baseline_advances,
        targets=targets,
        milestone_id=milestone_id,
        report_rel=args.report,
        contract_rel=args.contract,
        targets_rel=args.watch_targets,
        milestone_dir_rel=args.milestone_dir,
    )

    # A baseline advance with no anchor change still merits writing the refreshed
    # contract so the new ref name becomes the comparison point next run.
    should_write_outputs = args.update and (
        not old_contract_exists or bool(changes) or watchlist_changed or bool(baseline_advances)
    )

    if should_write_outputs:
        atomic_write_json(contract_path, new_contract)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report_text, encoding="utf-8")
        if milestone_id:
            snapshot = load_json(project_dir / PROJECT_SNAPSHOT_REL)
            milestone = build_milestone(
                milestone_id,
                generated_at=generated_at,
                latest_accepted=str(snapshot.get("latest_accepted_milestone", "")),
                changed_targets=impacted_targets(targets, changes),
                changes=changes,
                watchlist_changed=watchlist_changed,
                report_rel=args.report,
                contract_rel=args.contract,
                targets_rel=args.watch_targets,
            )
            update_milestone_state(
                project_dir,
                milestone,
                report_rel=args.report,
                contract_rel=args.contract,
                targets_rel=args.watch_targets,
            )
    elif args.update:
        print("No watched Zotero upstream anchors changed; leaving existing contract/report untouched.")
    else:
        print(report_text)

    if args.check_only and (not old_contract_exists or changes or watchlist_changed):
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.update and not args.check_only:
        args.check_only = True
    try:
        return run(args)
    except Exception as exc:
        print(f"check_zotero_upstream: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
