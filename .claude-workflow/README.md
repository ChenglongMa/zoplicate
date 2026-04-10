# Zoplicate Claude Workflow

This directory keeps the Claude workflow assets separate from product code.

## Separation model

Claude still needs a few discovery entrypoints at the repository root:

- `CLAUDE.md`
- `.claude/`
- `.mcp.json`

Everything else that belongs to the workflow lives here:

- `docs/ai/`: machine-readable milestone state and operator docs
- `scripts/agent/`: hooks, watchdog, test runner, and state tooling
- `scripts/ci/`: workflow integrity checks
- `config/` and `prompts/`: rerender inputs if you want to refresh the workflow contract later
- `state/`: runtime checkpoints, logs, shared artifacts, and episodic memory

## Maintenance rule

Treat `.claude-workflow/` as framework infrastructure. Normal product milestones should avoid editing it unless the workflow itself is the target.
