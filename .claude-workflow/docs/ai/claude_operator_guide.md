# Claude Operator Guide

This is the concise operator guide for the current Zoplicate workflow.

## Public entrypoint

Use only:

```text
/milestone-loop milestone=M001 approval=manual
/milestone-loop milestone=M002 approval=auto
```

Resume with:

```text
/milestone-loop resume=latest
```

## Runtime layout

Claude workflow state is kept under `.claude-workflow/state/`:

- `runtime/working.json`: current session state
- `runtime/checkpoints/`: checkpoints
- `shared/`: small JSON artifacts between phases
- `logs/<session_id>/`: test and watchdog logs
- `memory/`: episodic JSONL store

## Core scripts

- `uv run python .claude-workflow/scripts/agent/state_manager.py`
- `bash .claude-workflow/scripts/agent/run_tests_bg.sh`
- `bash .claude-workflow/scripts/agent/watchdog.sh`
- `uv run python .claude-workflow/scripts/agent/parse_test_log.py`
- `bash .claude-workflow/scripts/agent/run_overnight.sh`
- `uv run python .claude-workflow/scripts/ci/check_stop.py`

## Agent set

- `architect-planner`: plan generation, read-only
- `plan-reviewer`: plan critique, read-only
- `implementer`: code changes, only write-capable workflow agent
- `verifier-debugger`: failure diagnosis, read-only
- `code-reviewer`: post-implementation review, read-only

Current semantic shared artifacts:

- `current_plan.json`
- `plan_review.json`
- `implementation_summary.json`
- `test_summary.json`
- `diagnosis.json`
- `code_review.json`

## Hook mode

The `ZOPLICATE_HOOK_MODE` environment variable controls hook behavior.

### Hook behavior by mode

| Hook | `full` (default) | `minimal` |
|------|-------------------|-----------|
| `hook_secret_guard.sh` | Always runs | Always runs |
| `state_gate.sh` | Enforces phase gate | Skips if parent PID dead or absent; enforces if parent PID alive |
| `hook_checkpoint.sh` | Auto-checkpoint with 30s debounce | Skipped |
| `hook_stop.sh` | Runs `check_stop.py` | Runs `check_stop.py` |

### Usage by work mode

| Work mode | Hook mode | How to set |
|-----------|-----------|------------|
| CLI/tmux unattended milestone | `full` | Default; no env var needed |
| VSCode interactive editing | `minimal` | `export ZOPLICATE_HOOK_MODE=minimal` |
| CLI interactive (ad hoc) | `minimal` | `ZOPLICATE_HOOK_MODE=minimal claude` |

### How minimal mode detects active runs

In `minimal` mode, `state_gate.sh` reads `parent_pid` from `working.json` and checks whether that process is alive via `kill -0`. If the parent process is dead or absent, the phase gate is skipped.

### Recovery from stale state

```bash
export ZOPLICATE_HOOK_MODE=minimal
rm .claude-workflow/state/runtime/working.json
tmux kill-session -t "$(tmux ls 2>/dev/null | grep zoplicate_watchdog_ | cut -d: -f1)" 2>/dev/null
```

## Watchdog and tmux safety

- Watchdog interrupts must target an explicit PID or an explicit tmux session name.
- Do not use global `pkill -f "claude"` behavior.
- Do not reuse fixed tmux session names across milestones when a session-specific name is available.
- Session naming convention: `zoplicate_watchdog_<SESSION_KEY>` and `zoplicate_test_<SESSION_KEY>`.

## Operating notes

- `.claude-workflow/docs/ai/project_snapshot.json` is the automation source of truth.
- `.claude-workflow/docs/ai/milestone_index.json` is the milestone ordering and status index.
- Do not store large logs in `.claude-workflow/state/shared/`.
- Do not use global process-kill commands for Claude.

## Unattended usage

Batch execution:

```bash
bash .claude-workflow/scripts/agent/run_overnight.sh milestones.txt
```

The overnight runner writes logs to `.claude-workflow/state/logs/overnight/`.

### Permission mode for unattended runs

Do not pass `--permission-mode auto` to unattended `-p` runs. Let Claude CLI use the project's `settings.json` `defaultMode` by omitting `--permission-mode` entirely.

If you must override, use `--permission-mode acceptEdits` or `--permission-mode bypassPermissions`.

## Troubleshooting

- Validate workflow contract:
  `uv run python .claude-workflow/scripts/ci/check_stop.py`
- Validate current runtime state:
  `bash .claude-workflow/scripts/agent/validate_state.sh`
- Resume from the latest checkpoint:
  `uv run python .claude-workflow/scripts/agent/state_manager.py resume --checkpoint latest`

## Workflow audit

Audit scope:

- `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/*.md`, `.claude/skills/milestone-loop/SKILL.md`
- `.mcp.json`, `.claude-workflow/scripts/agent/*`, `.claude-workflow/scripts/ci/check_stop.py`
- `.claude-workflow/docs/ai/project_snapshot.json`, `.claude-workflow/docs/ai/milestone_index.json`, `.claude-workflow/docs/ai/milestones/{ID}.json`

Priority order:

1. Process fidelity
2. Scope control
3. Single-writer safety
4. Verification discipline
5. Session isolation for CLI/tmux unattended work
6. Cross-file consistency
7. Prompt quality

Core audit questions:

- Does `CLAUDE.md` match the machine-readable snapshot and runtime layout?
- Is `/milestone-loop` the only public skill?
- Is `implementer` the only write-capable workflow agent?
- Do read-only agents return structured output instead of writing files?
- Does `check_stop.py` validate the current workflow contract?
- Does the watchdog require an explicit PID or tmux session target?
