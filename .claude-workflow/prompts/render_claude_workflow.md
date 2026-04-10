# Render Zoplicate Claude Workflow Files

You are rendering the Zoplicate-specific Claude workflow from the hidden workflow source stored in `.claude-workflow/`.

## Inputs

- `.claude-workflow/config/workflow.config.yaml` is the single source of truth.
- Root Claude discovery files already exist and must remain at the repository root.
- `.claude-workflow/` contains the workflow docs and runtime scripts that should stay separated from product code.

## Task

Refresh the workflow contract while preserving the separation model:

- keep `CLAUDE.md` at the repository root,
- keep `.claude/` at the repository root,
- keep `.mcp.json` at the repository root,
- keep machine-readable workflow docs under `.claude-workflow/docs/ai/`,
- keep workflow scripts under `.claude-workflow/scripts/`,
- keep runtime state under `.claude-workflow/state/`.

## Hard rules

- Do not move product code into `.claude-workflow/`.
- Do not move workflow runtime state into `src/`, `addon/`, or `docs/`.
- Do not invent new agents, skills, or public entrypoints.
- Keep `/milestone-loop` as the only public skill.
- Keep `architect-planner`, `plan-reviewer`, `implementer`, `verifier-debugger`, and `code-reviewer` as the workflow agent names.
- Keep `implementer` as the only write-capable workflow agent.
- Keep `tmux/watchdog` and `episodic-memory` enabled unless the config explicitly says otherwise.
- After rendering, no `{{...}}` placeholders may remain.

## Verification steps

1. Confirm the expected workflow files exist.
2. Search the written workflow files for leftover `{{` or `}}` tokens and remove them.
3. Run the workflow integrity check when the environment is ready:
   `uv run python .claude-workflow/scripts/ci/check_stop.py`
4. Summarize:
   - files written
   - assumptions used
   - checks run and results
