"""Fast integrity check for the current Claude workflow surface."""

from __future__ import annotations

import importlib
import json
import sys
from collections.abc import Iterable
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.agent.workflow_state import (
    REQUIRED_SNAPSHOT_FIELDS,
    REQUIRED_WORKFLOW_FILES,
    build_paths,
    validate_state_payload,
)

WORKFLOW_REQUIRED_MODULES = [
    "scripts.agent.episodic_mcp_server",
]
PROJECT_REQUIRED_MODULES: list[str] = []
REQUIRED_MODULES = WORKFLOW_REQUIRED_MODULES + PROJECT_REQUIRED_MODULES
REQUIRED_FILES = REQUIRED_WORKFLOW_FILES
LEGACY_FILES = [
    ".claude/skills/state-manager/SKILL.md",
]
JSON_FILES = [
    ".claude/settings.json",
    ".mcp.json",
    ".claude-workflow/docs/ai/project_snapshot.json",
]
CLAUDE_REQUIRED_STRINGS = [
    "/milestone-loop",
    ".claude-workflow/docs/ai/project_snapshot.json",
    ".claude-workflow/state/runtime/working.json",
    "implementer",
]
CODEBASE_SERVER_NAME = "zoplicate-codebase"
WORKFLOW_SERVER_NAME = "zoplicate-workflow"
ZOTERO_SERVER_NAME = "zotero-reference"
CODEBASE_PATHS = {
    "src",
    "tests",
    "addon",
    "typings",
    "scripts",
    "docs",
}
WORKFLOW_PATHS = {
    ".claude",
    ".claude-workflow",
}
ZOTERO_PATHS = {
    ".references/zotero/app",
    ".references/zotero/chrome",
    ".references/zotero/defaults",
    ".references/zotero/resource",
    ".references/zotero/scripts",
    ".references/zotero/scss",
    ".references/zotero/styles",
    ".references/zotero/test",
    ".references/zotero/translators",
    ".references/zotero/types",
    ".references/zotero/reader",
    ".references/zotero/note-editor",
    ".references/zotero/pdf-worker",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def print_check(label: str, ok: bool) -> None:
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}")


def file_exists_check(path: Path) -> tuple[str, bool]:
    return (f"exists {path.as_posix()}", path.exists())


def file_absent_check(path: Path) -> tuple[str, bool]:
    return (f"absent {path.as_posix()}", not path.exists())


def import_check(module_name: str) -> tuple[str, bool]:
    try:
        importlib.import_module(module_name)
        return (f"import {module_name}", True)
    except Exception as exc:  # pragma: no cover - defensive runtime check
        return (f"import {module_name} FAILED: {exc}", False)


def json_valid_check(path: Path) -> tuple[str, bool]:
    if not path.exists():
        return (f"{path.as_posix()} missing", False)
    try:
        json.loads(path.read_text(encoding="utf-8"))
        return (f"{path.as_posix()} is valid JSON", True)
    except json.JSONDecodeError as exc:
        return (f"{path.as_posix()} invalid JSON: {exc}", False)


def text_contains_all(path: Path, required_strings: Iterable[str]) -> tuple[str, bool]:
    if not path.exists():
        return (f"{path.as_posix()} missing", False)
    text = path.read_text(encoding="utf-8")
    missing = [item for item in required_strings if item not in text]
    if missing:
        return (f"{path.as_posix()} missing required content: {', '.join(missing)}", False)
    return (f"{path.as_posix()} contains required workflow markers", True)


def snapshot_check(path: Path) -> list[tuple[str, bool]]:
    checks: list[tuple[str, bool]] = []
    if not path.exists():
        return [(f"{path.as_posix()} missing", False)]
    try:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [(f"{path.as_posix()} invalid JSON: {exc}", False)]

    for field in REQUIRED_SNAPSHOT_FIELDS:
        checks.append((f"project snapshot has field '{field}'", field in snapshot))
    checks.append(
        (
            "project snapshot open_risks_summary is a list",
            isinstance(snapshot.get("open_risks_summary"), list),
        )
    )
    return checks


def mcp_scope_check(path: Path, server_name: str, required_paths: set[str], label: str) -> tuple[str, bool]:
    if not path.exists():
        return (f"{path.as_posix()} missing", False)
    config = json.loads(path.read_text(encoding="utf-8"))
    servers = config.get("mcpServers", {})
    server = servers.get(server_name)
    if not server:
        return (f"{server_name} MCP server missing", False)
    args = server.get("args", [])
    ok = required_paths.issubset(set(args))
    return (f"{label} MCP scope includes configured paths", ok)


def matcher_covers(matcher: str, *required_atoms: str) -> bool:
    atoms = {part.strip() for part in matcher.split("|") if part.strip()}
    return all(atom in atoms for atom in required_atoms)


def settings_hook_checks(path: Path) -> list[tuple[str, bool]]:
    if not path.exists():
        return [(f"{path.as_posix()} missing", False)]

    config = json.loads(path.read_text(encoding="utf-8"))
    hooks = config.get("hooks", {})
    session_start = hooks.get("SessionStart", [])
    user_prompt_submit = hooks.get("UserPromptSubmit", [])
    pre = hooks.get("PreToolUse", [])
    post = hooks.get("PostToolUse", [])
    stop = hooks.get("Stop", [])

    session_matchers = [entry.get("matcher", "") for entry in session_start]
    pre_matchers = [entry.get("matcher", "") for entry in pre]
    post_matchers = [entry.get("matcher", "") for entry in post]
    session_commands = [
        hook.get("command", "")
        for entry in session_start
        for hook in entry.get("hooks", [])
        if isinstance(hook, dict)
    ]
    prompt_commands = [
        hook.get("command", "")
        for entry in user_prompt_submit
        for hook in entry.get("hooks", [])
        if isinstance(hook, dict)
    ]

    return [
        (
            ".claude/settings.json has SessionStart matcher covering startup|resume",
            any(matcher_covers(matcher, "startup", "resume") for matcher in session_matchers),
        ),
        (
            ".claude/settings.json refreshes Zotero reference on SessionStart",
            any("update_zotero_reference.py" in command for command in session_commands),
        ),
        (
            ".claude/settings.json refreshes Zotero reference on UserPromptSubmit",
            any("update_zotero_reference.py" in command for command in prompt_commands),
        ),
        (
            ".claude/settings.json has PreToolUse matcher covering Read",
            any(matcher_covers(matcher, "Read") for matcher in pre_matchers),
        ),
        (
            ".claude/settings.json has PreToolUse matcher covering Bash",
            any(matcher_covers(matcher, "Bash") for matcher in pre_matchers),
        ),
        (
            ".claude/settings.json has PreToolUse matcher covering Edit|Write",
            any(matcher_covers(matcher, "Edit", "Write") for matcher in pre_matchers),
        ),
        (
            ".claude/settings.json has PostToolUse matcher covering Edit|Write",
            any(matcher_covers(matcher, "Edit", "Write") for matcher in post_matchers),
        ),
        (
            ".claude/settings.json has at least one Stop hook",
            isinstance(stop, list) and bool(stop),
        ),
    ]


def agent_state_check(paths) -> list[tuple[str, bool]]:
    checks: list[tuple[str, bool]] = []
    state_path = paths.working_path
    if not state_path.exists():
        return checks
    checks.append((f"exists {state_path.as_posix()}", True))
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [(f"runtime state invalid JSON: {exc}", False)]
    errors = validate_state_payload(state)
    if errors:
        for error in errors:
            checks.append((f"runtime state {error}", False))
    else:
        checks.append(("runtime state schema valid", True))
    return checks


def main() -> int:
    root = repo_root()
    paths = build_paths(root)
    checks: list[tuple[str, bool]] = []

    import os

    os.chdir(root)
    checks.append((f"cwd set to repo root: {root.as_posix()}", True))

    for rel_path in REQUIRED_FILES:
        checks.append(file_exists_check(root / rel_path))

    for rel_path in LEGACY_FILES:
        checks.append(file_absent_check(root / rel_path))

    for rel_path in JSON_FILES:
        checks.append(json_valid_check(root / rel_path))

    checks.extend(snapshot_check(paths.snapshot_path))
    checks.append(text_contains_all(root / "CLAUDE.md", CLAUDE_REQUIRED_STRINGS))
    checks.append(mcp_scope_check(root / ".mcp.json", CODEBASE_SERVER_NAME, CODEBASE_PATHS, "codebase"))
    checks.append(mcp_scope_check(root / ".mcp.json", WORKFLOW_SERVER_NAME, WORKFLOW_PATHS, "workflow"))
    checks.append(mcp_scope_check(root / ".mcp.json", ZOTERO_SERVER_NAME, ZOTERO_PATHS, "zotero reference"))
    checks.extend(settings_hook_checks(root / ".claude" / "settings.json"))

    for module_name in REQUIRED_MODULES:
        checks.append(import_check(module_name))

    checks.extend(agent_state_check(paths))

    all_ok = all(ok for _, ok in checks)
    for label, ok in checks:
        print_check(label, ok)

    if all_ok:
        print("\ncheck_stop: all checks passed.")
        return 0

    print("\ncheck_stop: some checks FAILED.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
