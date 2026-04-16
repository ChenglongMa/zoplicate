# Zoplicate Claude Workflow Contract

## Mission

Use Claude Code as the primary implementation path for Zoplicate, but keep the workflow:
- milestone-bounded,
- test-guided,
- auditable,
- restartable,
- and safe for single-user unattended CLI/tmux work.

Project description:
`A Zotero plugin that detects and manages duplicate items, supports bulk merge flows, and tracks non-duplicate decisions.`

Project goal:
`Deliver milestone-bounded maintenance and feature work for the repository without blurring workflow files and product code.`

Operational workflow files live under `.claude-workflow/` so AI workflow assets stay separate from product code and addon assets.

## Canonical sources

Use these files with distinct roles:

- `CLAUDE.md`: durable workflow and engineering rules
- `.claude-workflow/docs/ai/project_snapshot.json`: machine-readable project snapshot for automation
- `.claude-workflow/docs/ai/milestone_index.json`: milestone ordering, status, and backlog
- `.claude-workflow/docs/ai/milestones/{ID}.json`: per-milestone scope, acceptance, and dependencies
- `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`: Zotero upstream watchlist and dependency map
- `.claude-workflow/docs/ai/upstream/zotero_upstream_contract.json`: generated upstream anchor baseline
- `.claude-workflow/docs/ai/upstream/zotero_upstream_report.md`: generated upstream drift report
- `.claude-workflow/docs/ai/prompt_audit_log.md`: compact workflow and prompt governance log

Do not treat large prose docs as the machine source of truth.

## Non-negotiable engineering rules

- Workflow tooling runs on Python 3.11 plus `uv`.
- Use `npm` for project-specific commands where applicable.
- Every non-trivial code change must include or update tests.
- For bug fixes, prefer regression tests first.
- Keep repository layering intact.
- Never log secrets, commit secrets, or read blocked key material.
- Read runtime config from environment-backed settings, not committed literals.
- Follow these project rules:
  - Keep shipped Zotero runtime assets in `addon/` and TypeScript source in `src/`.
  - Prefer targeted Jest regression coverage for non-UI logic before touching Zotero-facing glue.
  - Preserve duplicate detection, merge, and non-duplicate behavior unless milestone scope explicitly changes it.
  - Avoid ad hoc workflow rewrites during normal product milestones.

## Architecture constraints

Apply these repository layer boundaries exactly:
- `src/index.ts`, `src/addon.ts`, `src/hooks.ts`: addon bootstrap and lifecycle hooks only
- `src/modules/`: feature workflows, Zotero UI integration, and orchestration glue
- `src/db/`: duplicate and non-duplicate persistence and query logic
- `src/utils/`: shared helpers, Zotero wrappers, and view utilities
- `addon/`: shipped plugin manifest, prefs, locale, and chrome assets

Do not put business logic in thin entrypoint layers.
Do not let addon asset changes drift away from the TypeScript behavior they support.

## Public Claude surface

The public skills are `/milestone-loop` and `/upstream-pr-milestone`. Do not suggest legacy skills (`/state-manager` or any archived helper).

Use `/milestone-loop` for product implementation and milestone execution. Use `/upstream-pr-milestone` only to review Zotero upstream watch PRs, synchronize the watchlist, regenerate upstream reports, and prepare draft milestone files.

## Agent model

Five agents live in `.claude/agents/`; `implementer` is the only write-capable workflow agent. Shared JSON artifacts are written by the orchestrator or workflow scripts, not by read-only agents.

Exception: `/upstream-pr-milestone` may write workflow monitoring metadata under `.claude-workflow/docs/ai/upstream/`, draft milestone files under `.claude-workflow/docs/ai/milestones/`, `.claude-workflow/docs/ai/milestone_index.json`, and `.claude-workflow/docs/ai/project_snapshot.json`. It must not change product logic in `src/`, `addon/`, or `typings/`; product fixes still go through `/milestone-loop` and `implementer`.

## Runtime layout

Runtime state lives under `.claude-workflow/state/`. See `.claude/skills/milestone-loop/SKILL.md` for the full directory layout. Do not store large logs in `.claude-workflow/state/shared/`.

## Session policy

One milestone per session. When `.claude-workflow/state/runtime/working.json` exists, prefer `resume=latest` over re-initializing. When starting fresh, initialize from `.claude-workflow/docs/ai/project_snapshot.json`.

## Context loading policy

Use tiered loading:

- Tier 0: `CLAUDE.md`, `.claude-workflow/state/runtime/working.json` if present, `.claude-workflow/docs/ai/project_snapshot.json`
- Tier 1: `.claude-workflow/docs/ai/milestone_index.json`, `.claude-workflow/docs/ai/milestones/{milestone_id}.json`, directly implicated code and tests
- Tier 2: `.claude-workflow/docs/ai/prompt_audit_log.md`, `.claude-workflow/docs/ai/claude_operator_guide.md`

Do not load Tier 2 files at session start. Load only when explicitly needed for audit, governance, or archaeology.

## Milestone policy

All work is milestone-bounded. If scope expands materially, stop and split the work.
The step-by-step planning checklist lives in `/milestone-loop` and the `architect-planner` agent.
Upstream watch PRs may generate draft milestones, but implementing those milestones remains a separate `/milestone-loop` session.

## Review and verification policy

Keep planning, approval, implementation, testing, diagnosis, code review, and state update as separate responsibilities.
Do not claim tests, docs, or commands were checked unless they were actually checked in the current session.

## Official docs first

When work depends on external SDKs, APIs, frameworks, Zotero behavior, or Claude Code behavior, consult official docs before finalizing the plan. State version assumptions and note unresolved uncertainty explicitly.

## Watchdog and tmux safety

Do not use global `pkill -f "claude"` behavior. Watchdog interrupts must target an explicit PID or tmux session name.
See `.claude-workflow/docs/ai/claude_operator_guide.md` for session naming conventions and tmux setup details.

## MCP servers

Four project-scoped MCP servers are configured in `.mcp.json`: `episodic-memory`, `zoplicate-codebase`, `zoplicate-workflow`, `zotero-reference`. Prefer scoped MCP reads over broad repository scans during planning and review.
Use `zotero-reference` for upstream Zotero implementation and lifecycle patterns. Treat `.references/zotero/` as a read-only reference clone, not product code.
Project hooks refresh `.references/zotero/` on Claude session start/resume and when a `/milestone-loop` or `/upstream-pr-milestone` prompt is submitted. If the reference looks stale, run `uv run python .claude-workflow/scripts/agent/update_zotero_reference.py --force`.

## State update policy

After an accepted milestone:
- update `.claude-workflow/docs/ai/project_snapshot.json` first,
- then update `.claude-workflow/docs/ai/milestones/{milestone_id}.json` status to `"accepted"`,
- then update `.claude-workflow/docs/ai/milestone_index.json` to advance the next milestone,
- and only then update history or audit files if workflow strategy changed.

Keep state updates concise and factual.

## Safety defaults

- No silent scope expansion
- No next-milestone implementation in the same run
- No fake verification claims
- No broad workflow rewrites during normal product milestones

If workflow files contradict each other, call out the contradiction explicitly and prefer the machine-readable snapshot plus this file.
