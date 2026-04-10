---
name: milestone-loop
description: The sole public Claude skill in this repository. Runs a milestone-bounded state-machine loop using script-backed state, logs, checkpoints, and review gates.
---

# milestone-loop

You are the single public workflow orchestrator for the Zoplicate repository.

You coordinate one milestone at a time through a bounded loop:

1. bootstrap
2. align
3. plan
4. plan_review
5. approval_gate
6. implement
7. test
8. diagnose
9. code_review
10. refine
11. update_state

All shared artifacts are written by the orchestrator or workflow scripts, not by read-only agents.

## Invocation

Parse arguments from `$ARGUMENTS`.

| Argument | Required | Default |
|----------|----------|---------|
| `milestone` | Yes unless `resume` | — |
| `approval` | No | `manual` |
| `resume` | No | — |
| `max_plan_rounds` | No | `3` |
| `max_fix_rounds` | No | `3` |
| `heartbeat_interval` | No | `10` |
| `watchdog_stale_minutes` | No | `30` |
| `testing` | No | `tdd` |

Examples:

```text
/milestone-loop milestone=M001 approval=manual
/milestone-loop milestone=M002 approval=auto
/milestone-loop resume=latest
```

If required arguments are missing, ask before continuing.

## Runtime scripts

Use these scripts instead of inline multi-line shell snippets:

- `uv run python .claude-workflow/scripts/agent/state_manager.py`
- `uv run python .claude-workflow/scripts/agent/update_zotero_reference.py`
- `bash .claude-workflow/scripts/agent/run_tests_bg.sh`
- `bash .claude-workflow/scripts/agent/watchdog.sh`
- `uv run python .claude-workflow/scripts/agent/parse_test_log.py`

## State model

Machine-readable project truth:
- `.claude-workflow/docs/ai/project_snapshot.json`
- `.claude-workflow/docs/ai/milestone_index.json`
- `.claude-workflow/docs/ai/milestones/{ID}.json`

Runtime state:
- `.claude-workflow/state/runtime/working.json`
- `.claude-workflow/state/runtime/checkpoints/*.json`

Shared JSON artifacts:
- `.claude-workflow/state/shared/current_plan.json`
- `.claude-workflow/state/shared/plan_review.json`
- `.claude-workflow/state/shared/code_review.json`
- `.claude-workflow/state/shared/test_summary.json`
- `.claude-workflow/state/shared/implementation_summary.json`
- `.claude-workflow/state/shared/diagnosis.json`

Logs and memory:
- `.claude-workflow/state/logs/<session_id>/`
- `.claude-workflow/state/memory/episodes.jsonl`

## Phase rules

### bootstrap

- Refresh `.references/zotero` with:
  `uv run python .claude-workflow/scripts/agent/update_zotero_reference.py --max-age-minutes 60`
  This should happen before reading upstream Zotero reference code. Project hooks also run this automatically on session start/resume and on `/milestone-loop` prompt submission.
- Fresh run: initialize runtime state with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py init --milestone <M> --approval <mode> --heartbeat-interval <N> --parent-pid $PPID`
  (goal is auto-read from `.claude-workflow/docs/ai/milestones/{M}.json`)
- Resume: restore state with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py resume --checkpoint <value> --parent-pid $PPID`
- Read `CLAUDE.md`, `.claude-workflow/docs/ai/project_snapshot.json`, and `.claude-workflow/state/runtime/working.json`.
- Start the watchdog in a session-specific tmux session and pass an explicit interrupt target:

```bash
AGENT_STATE_DIR="${ZOPLICATE_AGENT_STATE_DIR:-$CLAUDE_PROJECT_DIR/.claude-workflow/state}"
SESSION_ID=$(uv run python -c "import json; print(json.load(open('${AGENT_STATE_DIR}/runtime/working.json'))['session_id'])")
SESSION_KEY=$(printf '%s' "$SESSION_ID" | tr -cd '[:alnum:]' | cut -c1-8)
tmux kill-session -t "zoplicate_watchdog_${SESSION_KEY}" 2>/dev/null || true
WATCHDOG_ENV="CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR CLAUDE_PARENT_PID=$PPID CLAUDE_SESSION_ID=$SESSION_ID"
if [ -n "${ZOPLICATE_AGENT_STATE_DIR:-}" ]; then
  WATCHDOG_ENV="$WATCHDOG_ENV ZOPLICATE_AGENT_STATE_DIR=${ZOPLICATE_AGENT_STATE_DIR}"
fi
tmux new-session -d -s "zoplicate_watchdog_${SESSION_KEY}" \
  "$WATCHDOG_ENV bash .claude-workflow/scripts/agent/watchdog.sh <watchdog_stale_minutes> 60"
```

### align

- Read `.claude-workflow/docs/ai/milestone_index.json` for ordering and status.
- Read `.claude-workflow/docs/ai/milestones/{milestone_id}.json` for current milestone scope and acceptance.
- Verify ordering (`depends_on`), deviation policy, and scope boundaries.
- If deviation is required and not yet approved, stop and surface it explicitly.

### plan

- Set active agent with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py update-working --active-agent architect-planner --phase plan`
- Spawn `architect-planner`.
- Persist the returned JSON to `.claude-workflow/state/shared/current_plan.json` with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py write-shared current_plan.json --input '<json>'`
- Clear `active_agent` after the agent returns.

### plan_review

- Increment the review round in working state.
- Spawn `plan-reviewer`.
- Persist the returned JSON to `.claude-workflow/state/shared/plan_review.json`.
- If verdict is `REVISE` and rounds remain, go back to `plan`.
- If verdict is `REJECT` or rounds are exhausted, record an episode and stop.

### approval_gate

- `manual`: show the plan summary plus review findings and wait for `APPROVE PLAN` or `REVISE PLAN`.
- `auto`: proceed only if `plan-reviewer` returns `APPROVE` with zero critical or major findings.
- Never implement before approval in manual mode.

### implement

- Set active agent to `implementer`.
- Provide the approved plan and the testing mode.
- The implementer is the only workflow agent allowed to edit repo-tracked files.
- The implementer must return only one JSON object with:
  `changed_files`, `tests_changed`, `commands_run`, `result`, `remaining_risks`.
- Persist the returned JSON to `.claude-workflow/state/shared/implementation_summary.json` with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py write-shared implementation_summary.json --input '<json>'`
- If the implementer response is not valid JSON, record an episode and stop.

### test

- Run tests with:
  `bash .claude-workflow/scripts/agent/run_tests_bg.sh [test-args...]`
- `run_tests_bg.sh` writes the summary deterministically to `.claude-workflow/state/shared/test_summary.json`.
- If the test run passes, continue to `code_review`.
- If the test run fails, continue to `diagnose`.
- If the test run times out or crashes, record an episode and stop.

### diagnose

- Set active agent to `verifier-debugger`.
- Provide `.claude-workflow/state/shared/test_summary.json` and the raw log only when the summary is insufficient.
- Persist the returned JSON to `.claude-workflow/state/shared/diagnosis.json` with:
  `uv run python .claude-workflow/scripts/agent/state_manager.py write-shared diagnosis.json --input '<json>'`
- After `diagnose`, continue to `refine`.

### code_review

- Spawn `code-reviewer`.
- Persist the returned JSON to `.claude-workflow/state/shared/code_review.json`.
- `APPROVE` moves to `update_state`.
- `REVISE` moves to `refine` if rounds remain.

### refine

- Increment `fix_round`.
- `max_fix_rounds` is the total refine budget, regardless of whether the trigger is `test` or `code_review`.
- If coming from `diagnose`, pass the structured failure summary and verifier-debugger fix plan to `implementer`.
- If coming from `code_review`, pass the review findings to `implementer`.
- `code_review -> refine` does not go through `diagnose`; review findings are already the structured fix input.
- Re-run tests after each refine step and always return to `test`.

### update_state

- Update `.claude-workflow/docs/ai/project_snapshot.json`.
- Update `.claude-workflow/docs/ai/milestones/{milestone_id}.json`: set status to `"accepted"`.
- Update `.claude-workflow/docs/ai/milestone_index.json`: set current milestone status to `"accepted"`, advance next milestone to `"next"`.
- Update history only if the accepted milestone changed strategic state.
- Record a success episode.
- Create a final checkpoint.
- Stop the watchdog tmux session.

## Shared artifact policy

Read-only agents do not write files directly.
Persist their JSON output with `state_manager.py write-shared`.

## Hard rules

- One milestone per run.
- No silent scope expansion.
- No direct use of archived skills.
- No global `pkill -f "claude"` behavior.
- No large logs in `.claude-workflow/state/shared/`.
- No acceptance claims without real verification.
