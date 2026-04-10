#!/usr/bin/env python3
"""Refresh the local Zotero reference clone used by project-scoped MCP."""

from __future__ import annotations

import argparse
import contextlib
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

try:
    import fcntl
except ImportError:  # pragma: no cover - non-Unix fallback
    fcntl = None

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.agent.workflow_state import atomic_write_json, build_paths, ensure_layout

DEFAULT_REMOTE_URL = "https://github.com/zotero/zotero.git"
DEFAULT_BRANCH = "main"
DEFAULT_MAX_AGE_MINUTES = 60
STATUS_FILENAME = "zotero_reference_status.json"


@dataclass(frozen=True)
class RefreshConfig:
    project_dir: Path
    reference_dir: Path
    status_path: Path
    remote_url: str
    branch: str
    max_age_minutes: int
    force: bool


GitRunner = Callable[[Path, list[str]], str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh the local Zotero reference clone.")
    parser.add_argument("--project-dir", default=None, help="Override the project directory.")
    parser.add_argument(
        "--reference-dir",
        default=".references/zotero",
        help="Path to the local Zotero reference clone, relative to the project root by default.",
    )
    parser.add_argument("--remote-url", default=DEFAULT_REMOTE_URL)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--max-age-minutes", type=int, default=DEFAULT_MAX_AGE_MINUTES)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--from-user-prompt",
        action="store_true",
        help="Read UserPromptSubmit hook payload from stdin and refresh only for /milestone-loop prompts.",
    )
    parser.add_argument(
        "--prompt-prefix",
        default="/milestone-loop",
        help="Prompt prefix that should trigger a refresh when --from-user-prompt is used.",
    )
    return parser.parse_args()


def parse_utc_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def iso_utc(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def short_sha(value: str) -> str:
    return value[:12] if value else "unknown"


def status_message(payload: dict[str, Any]) -> str:
    state = payload.get("status", "unknown")
    head = short_sha(str(payload.get("head", "")))
    if state == "skipped":
        return f"Zotero reference is fresh at {head}; skipped refresh."
    if state == "cloned":
        return f"Zotero reference cloned at {head}."
    if state == "updated":
        previous = short_sha(str(payload.get("previous_head", "")))
        return f"Zotero reference updated {previous} -> {head}."
    if state == "unchanged":
        return f"Zotero reference already up to date at {head}."
    if state == "error":
        detail = str(payload.get("error", "refresh failed")).strip()
        if payload.get("head"):
            return f"Zotero reference refresh failed; using local {head}. {detail}"
        return f"Zotero reference refresh failed and no local copy is available. {detail}"
    return f"Zotero reference status: {state} ({head})."


def load_status(status_path: Path) -> dict[str, Any] | None:
    if not status_path.exists():
        return None
    try:
        return json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def should_handle_user_prompt(stdin_text: str, prompt_prefix: str) -> bool:
    try:
        payload = json.loads(stdin_text or "{}")
    except json.JSONDecodeError:
        return False
    prompt = str(payload.get("prompt", "")).lstrip()
    return prompt.startswith(prompt_prefix)


def is_refresh_due(
    status: dict[str, Any] | None,
    reference_dir: Path,
    max_age_minutes: int,
    force: bool,
    now: datetime,
) -> bool:
    if force or max_age_minutes < 0:
        return True
    if not (reference_dir / ".git").exists():
        return True
    if not status:
        return True
    checked_at = parse_utc_timestamp(str(status.get("checked_at", "")))
    if checked_at is None:
        return True
    age_minutes = (now - checked_at).total_seconds() / 60
    return age_minutes >= max_age_minutes


def run_git(cwd: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout.strip()


def rev_parse(reference_dir: Path, ref: str, git_runner: GitRunner) -> str:
    return git_runner(reference_dir, ["rev-parse", ref]).strip()


def build_config(args: argparse.Namespace) -> RefreshConfig:
    paths = build_paths(args.project_dir)
    ensure_layout(paths)
    project_dir = paths.project_dir
    reference_dir = Path(args.reference_dir)
    if not reference_dir.is_absolute():
        reference_dir = (project_dir / reference_dir).resolve()
    return RefreshConfig(
        project_dir=project_dir,
        reference_dir=reference_dir,
        status_path=paths.runtime_dir / STATUS_FILENAME,
        remote_url=args.remote_url,
        branch=args.branch,
        max_age_minutes=args.max_age_minutes,
        force=args.force,
    )


def write_status(status_path: Path, payload: dict[str, Any]) -> None:
    atomic_write_json(status_path, payload)


@contextlib.contextmanager
def reference_lock(lock_path: Path, timeout_seconds: float = 30.0):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as handle:
        if fcntl is None:
            yield
            return

        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for Zotero reference lock: {lock_path}")
                time.sleep(0.1)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def refresh_reference(
    config: RefreshConfig,
    *,
    git_runner: GitRunner = run_git,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or datetime.now(UTC)
    checked_at = iso_utc(current_time)
    with reference_lock(config.status_path.with_name("zotero_reference.lock")):
        existing_status = load_status(config.status_path)

        if not shutil.which("git"):
            payload = {
                "status": "error",
                "checked_at": checked_at,
                "reference_dir": str(config.reference_dir),
                "remote_url": config.remote_url,
                "branch": config.branch,
                "error": "git is not installed or not available in PATH.",
            }
            write_status(config.status_path, payload)
            return payload

        if not is_refresh_due(
            existing_status,
            config.reference_dir,
            config.max_age_minutes,
            config.force,
            current_time,
        ):
            payload = {
                "status": "skipped",
                "checked_at": checked_at,
                "last_updated_at": (existing_status or {}).get("last_updated_at", checked_at),
                "reference_dir": str(config.reference_dir),
                "remote_url": config.remote_url,
                "branch": config.branch,
                "head": str((existing_status or {}).get("head", "")),
            }
            write_status(config.status_path, payload)
            return payload

        config.reference_dir.parent.mkdir(parents=True, exist_ok=True)
        previous_head = ""

        try:
            if not (config.reference_dir / ".git").exists():
                git_runner(
                    config.project_dir,
                    [
                        "clone",
                        "--depth",
                        "1",
                        "--branch",
                        config.branch,
                        config.remote_url,
                        str(config.reference_dir),
                    ],
                )
                head = rev_parse(config.reference_dir, "HEAD", git_runner)
                payload = {
                    "status": "cloned",
                    "checked_at": checked_at,
                    "last_updated_at": checked_at,
                    "reference_dir": str(config.reference_dir),
                    "remote_url": config.remote_url,
                    "branch": config.branch,
                    "head": head,
                }
                write_status(config.status_path, payload)
                return payload

            previous_head = rev_parse(config.reference_dir, "HEAD", git_runner)
            git_runner(config.reference_dir, ["fetch", "--depth", "1", "origin", config.branch])
            remote_head = rev_parse(config.reference_dir, "FETCH_HEAD", git_runner)

            if remote_head != previous_head:
                git_runner(config.reference_dir, ["merge", "--ff-only", "FETCH_HEAD"])

            head = rev_parse(config.reference_dir, "HEAD", git_runner)
            status = "updated" if head != previous_head else "unchanged"
            payload = {
                "status": status,
                "checked_at": checked_at,
                "last_updated_at": checked_at if status == "updated" else (existing_status or {}).get("last_updated_at", checked_at),
                "reference_dir": str(config.reference_dir),
                "remote_url": config.remote_url,
                "branch": config.branch,
                "previous_head": previous_head,
                "head": head,
            }
            write_status(config.status_path, payload)
            return payload
        except subprocess.CalledProcessError as exc:
            local_head = previous_head
            if not local_head and (config.reference_dir / ".git").exists():
                try:
                    local_head = rev_parse(config.reference_dir, "HEAD", git_runner)
                except subprocess.CalledProcessError:
                    local_head = ""
            detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
            payload = {
                "status": "error",
                "checked_at": checked_at,
                "last_updated_at": (existing_status or {}).get("last_updated_at", ""),
                "reference_dir": str(config.reference_dir),
                "remote_url": config.remote_url,
                "branch": config.branch,
                "previous_head": previous_head,
                "head": local_head,
                "error": detail.splitlines()[0],
            }
            write_status(config.status_path, payload)
            return payload


def main() -> int:
    args = parse_args()
    if args.from_user_prompt:
        if not should_handle_user_prompt(sys.stdin.read(), args.prompt_prefix):
            return 0

    payload = refresh_reference(build_config(args))
    print(status_message(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
