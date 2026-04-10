#!/usr/bin/env python3
"""CLI state manager for the Claude workflow runtime."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.agent.episodic_store import query_by_context, query_by_pattern, record_episode
from scripts.agent.workflow_state import (
    APPROVAL_MODES,
    VALID_AGENTS,
    VALID_PHASES,
    AgentStatePaths,
    atomic_write_json,
    build_paths,
    default_open_risks,
    ensure_layout,
    load_milestone_goal,
    load_snapshot,
    load_state,
    sanitize_label,
    save_state,
    session_log_dir,
    utc_now,
    validate_state_payload,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage Claude workflow runtime state.")
    parser.add_argument("--project-dir", default=None, help="Override the project directory.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Initialize runtime state.")
    init_parser.add_argument("--milestone", required=True)
    init_parser.add_argument("--approval", default="manual", choices=tuple(sorted(APPROVAL_MODES)))
    init_parser.add_argument("--heartbeat-interval", type=int, default=10)
    init_parser.add_argument("--parent-pid", type=int, default=None)

    checkpoint_parser = subparsers.add_parser("checkpoint", help="Create a checkpoint.")
    checkpoint_parser.add_argument("--label", default=None)

    resume_parser = subparsers.add_parser("resume", help="Restore a checkpoint.")
    resume_parser.add_argument("--checkpoint", default="latest")
    resume_parser.add_argument("--parent-pid", type=int, default=None)

    episode_parser = subparsers.add_parser("record-episode", help="Record an episodic memory entry.")
    episode_parser.add_argument("--type", required=True, choices=("failure", "success", "dead_end", "lesson"))
    episode_parser.add_argument("--summary", required=True)
    episode_parser.add_argument("--phase", default=None)
    episode_parser.add_argument("--resolution", default="")
    episode_parser.add_argument("--details", default="{}")
    episode_parser.add_argument("--tags", default="")

    query_parser = subparsers.add_parser("query-episodes", help="Search episodic memory.")
    query_group = query_parser.add_mutually_exclusive_group(required=True)
    query_group.add_argument("--context")
    query_group.add_argument("--pattern")
    query_parser.add_argument("--top-k", type=int, default=5)

    subparsers.add_parser("validate", help="Validate working state.")

    compact_parser = subparsers.add_parser("compact", help="Delete old checkpoints and logs.")
    compact_parser.add_argument("--keep-days", type=int, default=7)

    update_parser = subparsers.add_parser("update-working", help="Update selected working-state fields.")
    update_parser.add_argument("--phase")
    update_parser.add_argument("--active-agent")
    update_parser.add_argument("--clear-active-agent", action="store_true")
    update_parser.add_argument("--plan-review-round", type=int)
    update_parser.add_argument("--fix-round", type=int)
    update_parser.add_argument("--tokens", type=int)
    update_parser.add_argument("--compact-summary")
    update_parser.add_argument("--touch", action="store_true")

    write_shared = subparsers.add_parser("write-shared", help="Write a shared JSON artifact.")
    write_shared.add_argument("name", help="Basename of the shared artifact.")
    write_shared.add_argument("--input", default=None, help="JSON payload. Reads stdin when omitted.")
    write_shared.add_argument("--raw", action="store_true", help="Store raw text instead of parsed JSON.")

    return parser


def _init(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    ensure_layout(paths)
    snapshot = load_snapshot(paths)
    session_id = str(uuid.uuid4())
    session_log_dir(paths, session_id).mkdir(parents=True, exist_ok=True)

    for artifact in paths.shared_dir.glob("*"):
        if artifact.is_file():
            artifact.unlink()

    state = {
        "schema_version": "2.0",
        "session_id": session_id,
        "milestone_id": args.milestone,
        "milestone_goal": load_milestone_goal(paths, args.milestone),
        "current_phase": "bootstrap",
        "active_agent": "",
        "phase_history": [],
        "latest_accepted_milestone": snapshot["latest_accepted_milestone"],
        "current_target_milestone": snapshot["current_target_milestone"],
        "current_status": "active",
        "approval_mode": args.approval,
        "heartbeat_interval": args.heartbeat_interval,
        "tool_calls_since_heartbeat": 0,
        "plan_review_round": 0,
        "fix_round": 0,
        "tokens_consumed_estimate": 0,
        "compact_state_summary": "",
        "files_in_scope": [],
        "open_risks_summary": default_open_risks(snapshot),
        "log_dir": str(session_log_dir(paths, session_id).relative_to(paths.project_dir)),
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    if args.parent_pid is not None:
        state["parent_pid"] = args.parent_pid
    save_state(paths, state)
    print(f"State initialized for {args.milestone}. Session: {session_id}")
    return 0


def _checkpoint(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    if not paths.working_path.exists():
        return 0
    state = load_state(paths)
    label = sanitize_label(args.label or state["current_phase"])
    filename = f"{state['milestone_id']}_{label}_{datetime.now(UTC):%Y%m%dT%H%M%S}.json"
    atomic_write_json(paths.checkpoints_dir / filename, state)
    print(filename)
    return 0


def _resume(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    if args.checkpoint == "latest":
        candidates = sorted(paths.checkpoints_dir.glob("*.json"), key=lambda path: path.stat().st_mtime)
        if not candidates:
            print("No checkpoints available.", file=sys.stderr)
            return 2
        checkpoint = candidates[-1]
    else:
        checkpoint = paths.checkpoints_dir / args.checkpoint
        if not checkpoint.exists():
            print(f"Checkpoint not found: {checkpoint.name}", file=sys.stderr)
            return 2

    state = json.loads(checkpoint.read_text(encoding="utf-8"))
    if state.get("approval_mode") == "auto-strict":
        state["approval_mode"] = "auto"
    state["updated_at"] = utc_now()
    if args.parent_pid is not None:
        state["parent_pid"] = args.parent_pid
    errors = validate_state_payload(state)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 2
    save_state(paths, state)
    print(f"Resumed {checkpoint.name}")
    return 0


def _record_episode(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    state = load_state(paths)
    tags = [tag.strip() for tag in args.tags.split(",") if tag.strip()]
    details = json.loads(args.details)
    payload = record_episode(
        paths,
        episode_type=args.type,
        milestone_id=state["milestone_id"],
        phase=args.phase or state["current_phase"],
        summary=args.summary,
        details=details,
        resolution=args.resolution,
        tags=tags,
    )
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _query_episodes(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    if args.context:
        result = query_by_context(paths, args.context, top_k=args.top_k)
        if not result:
            result = query_by_pattern(paths, args.context, top_k=args.top_k)
    else:
        result = query_by_pattern(paths, args.pattern, top_k=args.top_k)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def _validate(paths: AgentStatePaths) -> int:
    if not paths.working_path.exists():
        return 0
    state = json.loads(paths.working_path.read_text(encoding="utf-8"))
    errors = validate_state_payload(state)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 2
    print("State valid")
    return 0


def _compact(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    ensure_layout(paths)
    cutoff = datetime.now(UTC) - timedelta(days=args.keep_days)
    removed = 0
    for directory in (paths.checkpoints_dir, paths.logs_dir):
        for item in directory.rglob("*"):
            if not item.exists():
                continue
            try:
                modified = datetime.fromtimestamp(item.stat().st_mtime, tz=UTC)
            except FileNotFoundError:
                continue
            if modified >= cutoff:
                continue
            if item.is_file():
                item.unlink()
                removed += 1
        for subdir in sorted(directory.rglob("*"), reverse=True):
            if subdir.is_dir() and not any(subdir.iterdir()):
                subdir.rmdir()
    print(f"Compacted {removed} items")
    return 0


def _update_working(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    state = load_state(paths)
    if args.phase:
        if args.phase not in VALID_PHASES:
            print(f"invalid phase: {args.phase}", file=sys.stderr)
            return 2
        state["current_phase"] = args.phase
        state.setdefault("phase_history", []).append({"phase": args.phase, "timestamp": utc_now()})
    if args.clear_active_agent:
        state["active_agent"] = ""
    elif args.active_agent is not None:
        if args.active_agent not in VALID_AGENTS:
            print(f"WARNING: unknown active agent: {args.active_agent}", file=sys.stderr)
        state["active_agent"] = args.active_agent
    if args.plan_review_round is not None:
        state["plan_review_round"] = args.plan_review_round
    if args.fix_round is not None:
        state["fix_round"] = args.fix_round
    if args.tokens is not None:
        state["tokens_consumed_estimate"] = args.tokens
    if args.compact_summary is not None:
        state["compact_state_summary"] = args.compact_summary
    save_state(paths, state)
    print("State updated")
    return 0


def _write_shared(paths: AgentStatePaths, args: argparse.Namespace) -> int:
    ensure_layout(paths)
    name = Path(args.name).name
    payload = args.input if args.input is not None else sys.stdin.read()
    target = paths.shared_dir / name
    if args.raw:
        target.write_text(payload, encoding="utf-8")
        print(str(target))
        return 0

    data = json.loads(payload)
    atomic_write_json(target, data)
    print(str(target))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    paths = build_paths(args.project_dir)
    ensure_layout(paths)

    if args.command == "init":
        return _init(paths, args)
    if args.command == "checkpoint":
        return _checkpoint(paths, args)
    if args.command == "resume":
        return _resume(paths, args)
    if args.command == "record-episode":
        return _record_episode(paths, args)
    if args.command == "query-episodes":
        return _query_episodes(paths, args)
    if args.command == "validate":
        return _validate(paths)
    if args.command == "compact":
        return _compact(paths, args)
    if args.command == "update-working":
        return _update_working(paths, args)
    if args.command == "write-shared":
        return _write_shared(paths, args)
    parser.error(f"unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
