#!/usr/bin/env python3
"""Track Zotero upstream implementation contracts used by Zoplicate."""

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
DEFAULT_PRIMARY_REF = "9.0"
DEFAULT_SECONDARY_REF = "main"
WATCH_TARGETS_REL = ".claude-workflow/docs/ai/upstream/zotero_watch_targets.json"
CONTRACT_REL = ".claude-workflow/docs/ai/upstream/zotero_upstream_contract.json"
REPORT_REL = ".claude-workflow/docs/ai/upstream/zotero_upstream_report.md"
MILESTONE_REL = ".claude-workflow/docs/ai/milestones"
MILESTONE_INDEX_REL = ".claude-workflow/docs/ai/milestone_index.json"
PROJECT_SNAPSHOT_REL = ".claude-workflow/docs/ai/project_snapshot.json"


@dataclass(frozen=True)
class AnchorResult:
    status: str
    source_path: str
    anchor_text: str
    sha256: str
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


def extract_anchor(text: str, anchor_kind: str, anchor_pattern: str) -> str:
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
            anchor_text = extract_anchor(text, target["anchor_kind"], target["anchor_pattern"])
            return AnchorResult(
                status="ok",
                source_path=rel_path,
                anchor_text=anchor_text,
                sha256=sha256_text(anchor_text),
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


def git_output(cwd: Path, args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True, check=True)
    return result.stdout.strip()


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


def collect_snapshots(ref_dirs: dict[str, Path], targets: list[dict[str, Any]]) -> dict[str, Any]:
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
                "sha256": result.sha256,
                "message": result.message,
            }
        snapshots[ref] = {"head": head, "anchors": anchors}
    return snapshots


def compare_contracts(old: dict[str, Any] | None, new: dict[str, Any]) -> list[dict[str, Any]]:
    if not old:
        return []
    changes: list[dict[str, Any]] = []
    old_snapshots = old.get("snapshots", {})
    for ref, snapshot in new.get("snapshots", {}).items():
        old_snapshot = old_snapshots.get(ref, {})
        old_anchors = old_snapshot.get("anchors", {})
        for target_id, anchor in snapshot.get("anchors", {}).items():
            old_anchor = old_anchors.get(target_id)
            if old_anchor != anchor:
                changes.append(
                    {
                        "ref": ref,
                        "target_id": target_id,
                        "old_sha256": (old_anchor or {}).get("sha256", ""),
                        "new_sha256": anchor.get("sha256", ""),
                        "old_status": (old_anchor or {}).get("status", "missing"),
                        "new_status": anchor.get("status", "missing"),
                        "source_path": anchor.get("source_path", ""),
                    }
                )
    return changes


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


def build_report(
    *,
    generated_at: str,
    remote_url: str,
    refs: list[str],
    old_contract_exists: bool,
    watchlist_changed: bool,
    changes: list[dict[str, Any]],
    targets: list[dict[str, Any]],
    milestone_id: str | None,
    report_rel: str,
    contract_rel: str,
    targets_rel: str,
    milestone_dir_rel: str,
) -> str:
    lines = [
        "# Zotero Upstream Watch Report",
        "",
        f"- Generated: `{generated_at}`",
        f"- Remote: `{remote_url}`",
        f"- Refs: `{', '.join(refs)}`",
        f"- Watchlist changed: `{'yes' if watchlist_changed else 'no'}`",
        f"- Baseline existed: `{'yes' if old_contract_exists else 'no'}`",
        f"- Draft milestone: `{milestone_id or 'none'}`",
        "",
    ]

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
        lines.extend(["## Changed Targets", ""])
        if changes:
            lines.extend(["| Ref | Target | Old | New | Status | Source |", "| --- | --- | --- | --- | --- | --- |"])
            for change in changes:
                old_sha = (change["old_sha256"] or change["old_status"])[:12]
                new_sha = (change["new_sha256"] or change["new_status"])[:12]
                lines.append(
                    f"| `{change['ref']}` | `{change['target_id']}` | `{old_sha}` | `{new_sha}` | "
                    f"`{change['old_status']} -> {change['new_status']}` | `{change['source_path']}` |"
                )
            lines.append("")
        else:
            lines.extend(["No upstream anchor hashes changed.", ""])

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
            "1. Review this report and `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`.",
            "2. If a draft milestone was generated, run `/upstream-pr-milestone pr=<pr> mode=review` before `/milestone-loop`.",
            "3. If the PR changes Zoplicate's Zotero-facing dependencies, run `/upstream-pr-milestone pr=<pr> mode=sync-watchlist`.",
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
    watchlist_changed: bool,
    report_rel: str,
    contract_rel: str,
    targets_rel: str,
) -> dict[str, Any]:
    target_ids = [target["id"] for target in changed_targets]
    tests = sorted({test for target in changed_targets for test in target.get("recommended_tests", [])})
    manual_targets = [target["id"] for target in changed_targets if target.get("needs_manual_mapping")]
    acceptance = [
        f"Review {report_rel} and classify every changed target.",
        "Update only the Zoplicate code paths impacted by the changed upstream targets.",
        "Run uv run python .claude-workflow/scripts/ci/check_zotero_upstream.py --check-only after fixes.",
        "Run uv run python .claude-workflow/scripts/ci/check_stop.py.",
        "Run npx tsc --noEmit.",
    ]
    if tests:
        acceptance.append("Run targeted tests: " + " ".join(tests) + ".")
    else:
        acceptance.append("Add or identify the smallest relevant regression test for each changed target.")
    if manual_targets:
        acceptance.append("Resolve manual upstream mappings: " + ", ".join(manual_targets) + ".")

    return {
        "id": milestone_id,
        "title": "Zotero upstream compatibility review",
        "phase": "Maintenance - Zotero Upstream Compatibility",
        "status": "next",
        "depends_on": [latest_accepted] if latest_accepted else [],
        "goal": "Review Zotero upstream changes that affect Zoplicate's duplicate detection, merge, patch, or UI integration contracts.",
        "in_scope": [
            "Inspect changed upstream watch targets: " + (", ".join(target_ids) if target_ids else "watchlist metadata"),
            "Update Zoplicate compatibility code and tests only where upstream changes require it.",
            "Refresh upstream contract snapshots after compatibility work.",
        ],
        "out_of_scope": [
            "Unrelated feature work",
            "Broad refactors not required by upstream compatibility",
            "Changing release metadata unless Zotero compatibility bounds actually change",
        ],
        "acceptance": acceptance,
        "upstream_watch": {
            "detected_at_utc": generated_at,
            "changed_targets": target_ids,
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

    snapshot = load_json(snapshot_path)
    snapshot["current_target_milestone"] = milestone_id
    snapshot["current_status"] = "planned"
    snapshot["last_updated_utc"] = utc_now()
    risks = snapshot.setdefault("open_risks_summary", [])
    risk = f"{milestone_id} generated by Zotero upstream watch; review {report_rel} before implementation."
    if risk not in risks:
        risks.append(risk)
    atomic_write_json(snapshot_path, snapshot)


def build_contract(
    *,
    generated_at: str,
    remote_url: str,
    refs: list[str],
    targets: list[dict[str, Any]],
    snapshots: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "generated_at_utc": generated_at,
        "remote_url": remote_url,
        "watched_refs": refs,
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
    refs = args.refs or [DEFAULT_PRIMARY_REF]
    refs.extend(args.also_refs or [DEFAULT_SECONDARY_REF])
    refs = list(dict.fromkeys(refs))
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

    temp_dir, ref_dirs = clone_refs(args.remote_url, refs)
    try:
        snapshots = collect_snapshots(ref_dirs, targets)
    finally:
        temp_dir.cleanup()

    new_contract = build_contract(
        generated_at=generated_at,
        remote_url=args.remote_url,
        refs=refs,
        targets=targets,
        snapshots=snapshots,
    )

    changes = compare_contracts(old_contract, new_contract)
    old_hash = (old_contract or {}).get("watch_targets_hash", "")
    watchlist_changed = bool(old_contract and old_hash != new_contract["watch_targets_hash"]) or watchlist_changed_by_diff
    old_contract_exists = old_contract is not None
    needs_milestone = old_contract_exists and (bool(changes) or watchlist_changed)

    milestone_id: str | None = None
    if needs_milestone:
        index = load_json(project_dir / MILESTONE_INDEX_REL)
        milestones_dir = project_dir / args.milestone_dir
        milestone_id = existing_open_upstream_milestone(milestones_dir) or next_milestone_id(index, milestones_dir)

    report_text = build_report(
        generated_at=generated_at,
        remote_url=args.remote_url,
        refs=refs,
        old_contract_exists=old_contract_exists,
        watchlist_changed=watchlist_changed,
        changes=changes,
        targets=targets,
        milestone_id=milestone_id,
        report_rel=args.report,
        contract_rel=args.contract,
        targets_rel=args.watch_targets,
        milestone_dir_rel=args.milestone_dir,
    )

    should_write_outputs = args.update and (not old_contract_exists or bool(changes) or watchlist_changed)

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
