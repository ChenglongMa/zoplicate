"""Shared state helpers for the Claude workflow tooling."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

VALID_PHASES = frozenset(
    (
        "bootstrap",
        "align",
        "plan",
        "plan_review",
        "approval_gate",
        "implement",
        "test",
        "diagnose",
        "code_review",
        "refine",
        "update_state",
    )
)

VALID_AGENTS = frozenset(
    (
        "architect-planner",
        "plan-reviewer",
        "implementer",
        "verifier-debugger",
        "code-reviewer",
    )
)

SHARED_ARTIFACTS = frozenset(
    (
        "current_plan.json",
        "plan_review.json",
        "code_review.json",
        "test_summary.json",
        "implementation_summary.json",
        "diagnosis.json",
    )
)

APPROVAL_MODES = frozenset(("manual", "auto"))

REQUIRED_WORKFLOW_FILES = (
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/skills/milestone-loop/SKILL.md",
    ".claude/skills/upstream-pr-milestone/SKILL.md",
    ".claude/agents/architect-planner.md",
    ".claude/agents/plan-reviewer.md",
    ".claude/agents/implementer.md",
    ".claude/agents/verifier-debugger.md",
    ".claude/agents/code-reviewer.md",
    ".mcp.json",
    ".github/workflows/zotero-upstream-watch.yml",
    ".claude-workflow/docs/ai/project_snapshot.json",
    ".claude-workflow/docs/ai/milestone_index.json",
    ".claude-workflow/docs/ai/prompt_audit_log.md",
    ".claude-workflow/docs/ai/claude_operator_guide.md",
    ".claude-workflow/docs/ai/upstream/zotero_watch_targets.json",
    ".claude-workflow/docs/ai/upstream/zotero_upstream_contract.json",
    ".claude-workflow/docs/ai/upstream/zotero_upstream_report.md",
    ".claude-workflow/scripts/agent/hook_secret_guard.sh",
    ".claude-workflow/scripts/agent/hook_checkpoint.sh",
    ".claude-workflow/scripts/agent/hook_stop.sh",
    ".claude-workflow/scripts/agent/state_manager.py",
    ".claude-workflow/scripts/agent/update_zotero_reference.py",
    ".claude-workflow/scripts/agent/state_gate.sh",
    ".claude-workflow/scripts/agent/validate_state.sh",
    ".claude-workflow/scripts/agent/parse_test_log.py",
    ".claude-workflow/scripts/agent/watchdog.sh",
    ".claude-workflow/scripts/agent/run_tests_bg.sh",
    ".claude-workflow/scripts/agent/run_overnight.sh",
    ".claude-workflow/scripts/ci/check_stop.py",
    ".claude-workflow/scripts/ci/check_zotero_upstream.py",
)

REQUIRED_STATE_FIELDS = (
    "schema_version",
    "session_id",
    "milestone_id",
    "milestone_goal",
    "current_phase",
    "approval_mode",
    "created_at",
    "updated_at",
)

REQUIRED_SNAPSHOT_FIELDS = (
    "schema_version",
    "latest_accepted_milestone",
    "current_target_milestone",
    "current_status",
    "last_updated_utc",
    "open_risks_summary",
)


@dataclass(frozen=True)
class AgentStatePaths:
    project_dir: Path
    workflow_root: Path
    agent_state_dir: Path
    runtime_dir: Path
    checkpoints_dir: Path
    shared_dir: Path
    logs_dir: Path
    memory_dir: Path
    working_path: Path
    snapshot_path: Path
    milestone_index_path: Path
    milestones_dir: Path
    prompt_audit_log_path: Path
    operator_guide_path: Path
    plans_dir: Path
    episodes_jsonl_path: Path


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def resolve_project_dir(project_dir: str | Path | None = None) -> Path:
    if project_dir is not None:
        return Path(project_dir).expanduser().resolve()
    env_project = Path.cwd()
    if "CLAUDE_PROJECT_DIR" in os.environ:
        env_project = Path(os.environ["CLAUDE_PROJECT_DIR"])
    return env_project.expanduser().resolve()


def resolve_agent_state_dir(project_dir: Path) -> Path:
    env_override = os.environ.get("ZOPLICATE_AGENT_STATE_DIR")
    if env_override:
        return Path(env_override).expanduser().resolve()
    return project_dir / ".claude-workflow" / "state"


def build_paths(project_dir: str | Path | None = None) -> AgentStatePaths:
    root = resolve_project_dir(project_dir)
    workflow_root = root / ".claude-workflow"
    agent_state_dir = resolve_agent_state_dir(root)
    runtime_dir = agent_state_dir / "runtime"
    shared_dir = agent_state_dir / "shared"
    logs_dir = agent_state_dir / "logs"
    memory_dir = agent_state_dir / "memory"
    docs_ai_root = workflow_root / "docs" / "ai"
    return AgentStatePaths(
        project_dir=root,
        workflow_root=workflow_root,
        agent_state_dir=agent_state_dir,
        runtime_dir=runtime_dir,
        checkpoints_dir=runtime_dir / "checkpoints",
        shared_dir=shared_dir,
        logs_dir=logs_dir,
        memory_dir=memory_dir,
        working_path=runtime_dir / "working.json",
        snapshot_path=docs_ai_root / "project_snapshot.json",
        milestone_index_path=docs_ai_root / "milestone_index.json",
        milestones_dir=docs_ai_root / "milestones",
        prompt_audit_log_path=docs_ai_root / "prompt_audit_log.md",
        operator_guide_path=docs_ai_root / "claude_operator_guide.md",
        plans_dir=docs_ai_root / "plans",
        episodes_jsonl_path=memory_dir / "episodes.jsonl",
    )


def ensure_layout(paths: AgentStatePaths) -> None:
    for path in (
        paths.workflow_root,
        paths.agent_state_dir,
        paths.runtime_dir,
        paths.checkpoints_dir,
        paths.shared_dir,
        paths.logs_dir,
        paths.memory_dir,
        paths.plans_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def load_snapshot(paths: AgentStatePaths) -> dict[str, Any]:
    if not paths.snapshot_path.exists():
        raise FileNotFoundError(f"Missing project snapshot: {paths.snapshot_path}")
    snapshot = read_json(paths.snapshot_path)
    missing = [field for field in REQUIRED_SNAPSHOT_FIELDS if field not in snapshot]
    if missing:
        raise ValueError(f"Invalid project snapshot; missing fields: {', '.join(missing)}")
    if not isinstance(snapshot["open_risks_summary"], list):
        raise ValueError("project snapshot field 'open_risks_summary' must be a list")
    return snapshot


def load_state(paths: AgentStatePaths) -> dict[str, Any]:
    if not paths.working_path.exists():
        raise FileNotFoundError(f"Missing working state: {paths.working_path}")
    state = read_json(paths.working_path)
    errors = validate_state_payload(state)
    if errors:
        raise ValueError("; ".join(errors))
    return state


def save_state(paths: AgentStatePaths, state: dict[str, Any]) -> None:
    state["updated_at"] = utc_now()
    atomic_write_json(paths.working_path, state)


def sanitize_label(label: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", label.strip())
    return cleaned.strip("-") or "checkpoint"


def session_log_dir(paths: AgentStatePaths, session_id: str) -> Path:
    return paths.logs_dir / session_id


def default_open_risks(snapshot: dict[str, Any]) -> list[str]:
    risks = snapshot.get("open_risks_summary", [])
    return [str(item) for item in risks[:5]]


def validate_state_payload(state: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_STATE_FIELDS:
        if field not in state:
            errors.append(f"missing required field: {field}")
    phase = state.get("current_phase")
    if phase and phase not in VALID_PHASES:
        errors.append(f"invalid phase: {phase}")
    approval_mode = state.get("approval_mode")
    if approval_mode and approval_mode not in APPROVAL_MODES:
        errors.append(f"invalid approval_mode: {approval_mode}")
    if "session_id" in state and not isinstance(state["session_id"], str):
        errors.append("session_id must be a string")
    if "milestone_id" in state and (
        not isinstance(state["milestone_id"], str) or not state["milestone_id"].strip()
    ):
        errors.append("milestone_id must be a non-empty string")
    if "milestone_goal" in state and not isinstance(state["milestone_goal"], str):
        errors.append("milestone_goal must be a string")
    if "tool_calls_since_heartbeat" in state and not isinstance(
        state["tool_calls_since_heartbeat"], int
    ):
        errors.append("tool_calls_since_heartbeat must be an integer")
    if "heartbeat_interval" in state and not isinstance(state["heartbeat_interval"], int):
        errors.append("heartbeat_interval must be an integer")
    if "phase_history" in state and not isinstance(state["phase_history"], list):
        errors.append("phase_history must be a list")
    if "open_risks_summary" in state and not isinstance(state["open_risks_summary"], list):
        errors.append("open_risks_summary must be a list")
    if "parent_pid" in state and (
        not isinstance(state["parent_pid"], int) or state["parent_pid"] <= 0
    ):
        errors.append("parent_pid must be a positive integer")
    return errors


def milestone_spec_path(paths: AgentStatePaths, milestone_id: str) -> Path:
    return paths.milestones_dir / f"{milestone_id}.json"


def load_milestone_goal(paths: AgentStatePaths, milestone_id: str) -> str:
    spec_file = milestone_spec_path(paths, milestone_id)
    if not spec_file.exists():
        raise FileNotFoundError(f"Missing milestone spec: {spec_file}")
    spec = read_json(spec_file)
    goal = spec.get("goal", "")
    if not isinstance(goal, str) or not goal.strip():
        raise ValueError(f"Milestone spec {spec_file} has empty or invalid 'goal' field")
    return goal.strip()
