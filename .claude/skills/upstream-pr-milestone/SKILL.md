---
name: upstream-pr-milestone
description: Review Zotero upstream watch PRs, synchronize the Zotero watchlist from PR diffs, regenerate upstream reports/contracts, and prepare draft milestones without modifying product code.
---

# upstream-pr-milestone

You triage Zotero upstream watch PRs for Zoplicate. Your job is to keep the upstream watch metadata accurate and to prepare milestone drafts that `/milestone-loop` can execute later.

This skill may write workflow metadata only:

- `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`
- `.claude-workflow/docs/ai/upstream/zotero_upstream_contract.json`
- `.claude-workflow/docs/ai/upstream/zotero_upstream_report.md`
- `.claude-workflow/docs/ai/milestones/M*.json`
- `.claude-workflow/docs/ai/milestone_index.json`
- `.claude-workflow/docs/ai/project_snapshot.json`

Do not modify product logic in `src/`, `addon/`, or `typings/`. If product code needs a fix, report the generated milestone and hand it to `/milestone-loop milestone=M###`.

## Invocation

Parse arguments from `$ARGUMENTS`.

| Argument | Required | Default |
|----------|----------|---------|
| `pr` | No | `local` |
| `mode` | No | `review` |

Examples:

```text
/upstream-pr-milestone pr=42 mode=review
/upstream-pr-milestone pr=https://github.com/<owner>/<repo>/pull/42 mode=sync-watchlist
/upstream-pr-milestone pr=local mode=regenerate
```

Modes:

- `review`: read-only review of PR diff, watchlist, upstream report, contract, and draft milestone.
- `sync-watchlist`: update `zotero_watch_targets.json` from PR diff, then regenerate contract/report/milestone.
- `regenerate`: regenerate contract/report/milestone from the current watchlist.

## Required Inputs

Read these first:

- `CLAUDE.md`
- `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`
- `.claude-workflow/docs/ai/upstream/zotero_upstream_contract.json` if present
- `.claude-workflow/docs/ai/upstream/zotero_upstream_report.md` if present
- `.claude-workflow/docs/ai/milestone_index.json`
- Latest `.claude-workflow/docs/ai/milestones/M*.json` that has `upstream_watch`, if present

## Diff Acquisition

For `pr=local`, use the current working tree:

```bash
git diff -- . ':!.references' > /tmp/zoplicate-upstream-pr.diff
```

For `pr=<number|url>`, use GitHub CLI:

```bash
gh pr view "$PR" --json number,title,body,labels,url,headRefName,baseRefName,files
gh pr diff "$PR" --patch > /tmp/zoplicate-upstream-pr.diff
```

If `gh` is unavailable, stop and ask for a local diff or a checked-out PR branch.

## Review Mode

Do not write files.

Check the PR against these rules:

- Upstream watch PRs should change only workflow metadata and generated upstream watch artifacts unless the PR intentionally includes product fixes.
- Any changed product file in `src/`, `addon/`, or `typings/` must be called out as out of scope for this skill.
- `zotero_watch_targets.json` is the only source of monitored upstream paths and anchors. The workflow YAML and script must not hardcode a second watchlist.
- Every report target should exist in the watchlist.
- Every generated milestone with `upstream_watch` should reference the report, contract, and watchlist paths.
- Manual mappings (`needs_manual_mapping: true`) must appear in report or milestone acceptance.

Also inspect the diff for local Zotero-facing dependency changes:

- Added or removed `Zotero.*` private API calls.
- Added or removed `ChromeUtils.importESModule("chrome://zotero/...")`.
- Added or removed Zotero DOM selectors, custom elements, pane IDs, notifier events, or MenuManager contexts.
- Added or removed monkey patch targets.
- Added or removed comments with Zotero upstream GitHub source links.

If those changes are present but the watchlist was not updated, report that `mode=sync-watchlist` is required.

Return a concise review with:

- `Verdict`: `approve`, `needs-sync-watchlist`, `needs-regenerate`, or `blocked`.
- `Findings`: concrete file/path references.
- `Commands Checked`: commands actually run.
- `Next Step`: either `/upstream-pr-milestone ... mode=sync-watchlist`, `/upstream-pr-milestone ... mode=regenerate`, or `/milestone-loop milestone=M###`.

## Sync-Watchlist Mode

1. Acquire the PR diff into `/tmp/zoplicate-upstream-pr.diff`.
2. Run:

```bash
uv run python .claude-workflow/scripts/ci/check_zotero_upstream.py --sync-watch-targets-from-pr-diff /tmp/zoplicate-upstream-pr.diff --update
```

3. Run:

```bash
uv run python .claude-workflow/scripts/ci/check_stop.py
```

4. Review the resulting diff. Ensure all writes are limited to the allowed workflow metadata paths listed above.

Automatic watchlist behavior:

- If a local dependency path disappeared and no remaining local dependency points to the same upstream anchor, remove that target.
- If a local file moved, update `local_dependency_paths` without changing the upstream anchor.
- If a new Zotero private API or chrome module dependency is detected, add a target with `risk_level: "medium"` and `needs_manual_mapping: true` unless the upstream anchor can be mapped reliably.
- If the upstream anchor is ambiguous, keep `needs_manual_mapping: true` and require manual confirmation in the report or milestone acceptance.

## Regenerate Mode

Run:

```bash
uv run python .claude-workflow/scripts/ci/check_zotero_upstream.py --update
uv run python .claude-workflow/scripts/ci/check_stop.py
```

Then review the generated report and milestone. If product code changes are required, do not implement them here; identify the milestone ID for `/milestone-loop`.

## Hard Rules

- No direct product fixes in this skill.
- No hidden watchlists outside `zotero_watch_targets.json`.
- No acceptance claims without running the listed checks.
- No guessing upstream anchors when the mapping is ambiguous; set `needs_manual_mapping: true`.
- Keep output actionable and short.
