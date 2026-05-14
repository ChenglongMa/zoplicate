# Zoplicate

A Zotero plugin that detects and manages duplicate items, supports bulk merge flows, and tracks non-duplicate decisions.

## Non-negotiable engineering rules

- Workflow tooling runs on Python 3.11 plus `uv`.
- Use `npm` for project-specific commands where applicable.
- Every non-trivial code change must include or update tests.
- For bug fixes, prefer regression tests first.
- Keep repository layering intact.
- Never log secrets, commit secrets, or read blocked key material.
- Read runtime config from environment-backed settings, not committed literals.
- Keep shipped Zotero runtime assets in `addon/` and TypeScript source in `src/`.
- Prefer targeted Jest regression coverage for non-UI logic before touching Zotero-facing glue.
- Preserve duplicate detection, merge, and non-duplicate behavior unless milestone scope explicitly changes it.

## Architecture constraints

- `src/index.ts`, `src/addon.ts`, `src/hooks.ts`: addon bootstrap and lifecycle hooks only
- `src/modules/`: feature workflows, Zotero UI integration, and orchestration glue
- `src/db/`: duplicate and non-duplicate persistence and query logic
- `src/utils/`: shared helpers, Zotero wrappers, and view utilities
- `addon/`: shipped plugin manifest, prefs, locale, and chrome assets

Do not put business logic in thin entrypoint layers.
Do not let addon asset changes drift away from the TypeScript behavior they support.

## Canonical sources

- `CLAUDE.md`: durable engineering rules and architecture
- `.workflow/project_snapshot.json`: machine-readable project snapshot
- `.workflow/milestone_index.json`: milestone ordering, status, and backlog
- `.workflow/milestones/{ID}.json`: per-milestone scope, acceptance, and dependencies
- `.workflow/upstream/zotero_watch_targets.json`: Zotero upstream watchlist and dependency map
- `.workflow/upstream/zotero_upstream_contract.json`: generated upstream anchor baseline
- `.workflow/upstream/zotero_upstream_report.md`: generated upstream drift report

## Public Claude surface

Two skills: `/milestone-tdd` (user-level, for product implementation) and `/upstream-pr-milestone` (project-level, for Zotero upstream PR triage).

`/upstream-pr-milestone` may write workflow metadata under `.workflow/upstream/`, `.workflow/milestones/`, `.workflow/milestone_index.json`, and `.workflow/project_snapshot.json`. It must not change product logic in `src/`, `addon/`, or `typings/`.

## Context loading policy

- Tier 0: `CLAUDE.md`, `.workflow/state/working.json` (if present), `.workflow/project_snapshot.json`
- Tier 1: `.workflow/milestone_index.json`, `.workflow/milestones/{ID}.json`, directly implicated code and tests
- Tier 2: `docs/ai/prompt_audit_log.md`, `docs/ai/claude_operator_guide.md`

Do not load Tier 2 files at session start.

## MCP servers

Four project-scoped MCP servers in `.mcp.json`: `episodic-memory`, `zoplicate-codebase`, `zoplicate-workflow`, `zotero-reference`. Prefer scoped MCP reads over broad repository scans.

Use `zotero-reference` for upstream Zotero implementation and lifecycle patterns. Treat `.references/zotero/` as read-only. Project hooks refresh `.references/zotero/` on session start and when `/milestone-tdd` or `/upstream-pr-milestone` prompts are submitted.

## State update policy

After an accepted milestone:
- update `.workflow/project_snapshot.json` first,
- then update `.workflow/milestones/{ID}.json` status to `"accepted"`,
- then update `.workflow/milestone_index.json` to advance next milestone,
- and only then update history or audit files if workflow strategy changed.
