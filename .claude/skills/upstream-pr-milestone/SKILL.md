---
name: upstream-pr-milestone
description: Review Zotero upstream watch PRs, synchronize the Zotero watchlist from PR diffs, regenerate upstream reports/contracts, and prepare draft milestones without modifying product code.
---

# upstream-pr-milestone

You triage Zotero upstream watch PRs for Zoplicate. Your job is to keep the upstream watch metadata accurate and to prepare milestone drafts that `/milestone-tdd` can execute later.

This skill may write workflow metadata only:

- `.workflow/upstream/zotero_watch_targets.json`
- `.workflow/upstream/zotero_upstream_contract.json`
- `.workflow/upstream/zotero_upstream_report.md`
- `.workflow/upstream/zotero_upstream_deep_verify.md`
- `.workflow/milestones/M*.json`
- `.workflow/milestone_index.json`
- `.workflow/project_snapshot.json`

Do not modify product logic in `src/`, `addon/`, or `typings/`. If product code needs a fix, report the generated milestone and hand it to `/milestone-tdd milestone=M###`.

## Core purpose

Zoplicate is a Zotero plugin that depends on concrete Zotero source behavior (private APIs, DOM, duplicate/merge logic). When Zotero changes that behavior, Zoplicate's logic can silently break. This skill exists to answer three questions, in order:

1. **Does the watched method still exist?** (cheap, deterministic — the Python script does this.)
2. **Does its behavioral contract still hold?** (the important one — requires reading the body, not just matching a name.)
3. **If logic was removed, where did it go, and does that new location also affect Zoplicate?** (cascade — one hop, then re-watch.)

A symbol name match is necessary but not sufficient. The real signal is whether the *behavior Zoplicate relies on* survived.

## The three-tier reference model

Zotero ships three moving references that can disagree. Adapt to the **released** version; treat `main` as an early-warning radar, not a to-do list.

| Tier | Ref | Role | Drift severity | What you do |
|------|-----|------|----------------|-------------|
| release | latest `X.Y.Z` tag | **baseline / truth** (users run this) | `urgent` | Fix and adapt now; regression-test against it. |
| beta | release branch (`9.0`) | upcoming release | `scheduled` | Pre-adapt before it ships. |
| dev | `main` | future / radar | `radar` | Track relocated logic; **do not change release-targeting product code yet.** |

Hard rule: a change seen **only on `main`** is `radar`. It must NOT advance product work to "next" or trigger product code edits. Adapting release code to match `main` would make Zoplicate target a version no user runs — the exact bug this model prevents.

The check script resolves the release tag automatically (`--release-series`, default `9.`) and snapshots all three tiers. The contract stores `ref_roles` so severity is derivable per ref.

## Single-source upstream policy

- The check script clones release/beta tiers as ephemeral verification checkouts (you never develop against a frozen tag).
- The dev tier reuses the shared `.references/zotero` clone when `--reference-dir .references/zotero` is passed, so there is one dev source of truth for both MCP reads and drift checks. Without that flag the dev tier is cloned fresh. Either way, `main` is the dev ref.
- Do not introduce a second hardcoded watchlist or a second upstream source. `zotero_watch_targets.json` is the only list of monitored paths/anchors/contracts.

## Watch-target schema

Each target in `zotero_watch_targets.json` carries:

- `anchor_kind`: a single shape (`function_assignment`, `class_method`, …) **or** a fallback group that tolerates syntax refactors:
  - `class_member` → tries `class_method` then `method_assignment` (arrow-field ⇄ method).
  - `function_any` → tries the three function shapes.
  Prefer the fallback group when upstream might flip declaration styles. A shape-only flip with an unchanged body is NOT reported as drift.
- `contracts`: 1–3 natural-language assertions of *what Zoplicate depends on this anchor doing*. This is the verification target, not the raw code.
- `cascade_hints`: where relocated logic is likely to surface, to seed one-hop tracing. Use `[[other-target-id]]` to link related targets.

## Invocation

Parse arguments from the prompt.

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
- `.workflow/upstream/zotero_watch_targets.json`
- `.workflow/upstream/zotero_upstream_contract.json` if present
- `.workflow/upstream/zotero_upstream_report.md` if present
- `.workflow/milestone_index.json`
- Latest `.workflow/milestones/M*.json` that has `upstream_watch`, if present

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

## Missing-anchor triage (do this before declaring breakage)

A report row `ok -> missing` does **not** mean the method was deleted. It means the
extractor's pattern stopped matching. Triage in order:

1. **Grep the symbol name** across the upstream clone for the affected ref. (The
   check script clones release/beta; the dev clone is `.references/zotero` or a fresh
   `main`.)
2. **Symbol still present** → it is a *declaration-shape refactor* (e.g.
   `name = (a) => {` became `name(a) {`). Fix is metadata-only: widen `anchor_kind`
   to the matching fallback group (`class_member` / `function_any`) and `regenerate`.
   Keep `needs_manual_mapping: false`.
3. **Symbol absent on that ref** → it is a *true removal/rename*. Set
   `needs_manual_mapping: true`, then run the deep-verify workflow (below) to trace
   where the logic relocated. The mapping is genuinely ambiguous until traced — never
   guess a new anchor.
4. **Tier matters.** If the symbol is missing only on `main` but present on the
   release tag, this is `radar`: record it, do not chase it with product code.

## Review Mode

Do not write files.

Check the PR against these rules:

- Upstream watch PRs should change only workflow metadata and generated upstream watch artifacts unless the PR intentionally includes product fixes.
- Any changed product file in `src/`, `addon/`, or `typings/` must be called out as out of scope for this skill.
- `zotero_watch_targets.json` is the only source of monitored upstream paths, anchors, and contracts. The workflow YAML and script must not hardcode a second watchlist.
- Every report target should exist in the watchlist.
- Every generated milestone with `upstream_watch` should reference the report, contract, and watchlist paths, and carry a `severity`.
- A `radar`-only milestone must have status `planned` (not `next`) and must not call for product code changes.
- Manual mappings (`needs_manual_mapping: true`) must appear in report or milestone acceptance.
- Changed targets with `contracts` must have those contracts listed for verification in the report/milestone.

Also inspect the diff for local Zotero-facing dependency changes:

- Added or removed `Zotero.*` private API calls.
- Added or removed `ChromeUtils.importESModule("chrome://zotero/...")`.
- Added or removed Zotero DOM selectors, custom elements, pane IDs, notifier events, or MenuManager contexts.
- Added or removed monkey patch targets.
- Added or removed comments with Zotero upstream GitHub source links.

If those changes are present but the watchlist was not updated, report that `mode=sync-watchlist` is required.

Return a concise review with:

- `Verdict`: `approve`, `needs-sync-watchlist`, `needs-regenerate`, or `blocked`.
- `Severity`: the worst tier severity among changed targets (`urgent` / `scheduled` / `radar` / `none`).
- `Findings`: concrete file/path references, with per-target tier and severity.
- `Commands Checked`: commands actually run.
- `Next Step`: one of `/upstream-pr-milestone ... mode=sync-watchlist`, `... mode=regenerate`, the deep-verify workflow, or `/milestone-tdd milestone=M###` (only when release/beta is affected).

## Contract verification (Layer B/C) — the deep-verify workflow

After the cheap anchor check flags drift, confirm whether the *behavior* actually
changed, per tier, and trace relocated logic. This is an agent task, not a regex
task. Run the workflow:

```text
Run the zotero-upstream-deep-verify workflow.
```

(`.claude/workflows/zotero-upstream-deep-verify.js`.) It:

- verifies each changed target's `contracts` on release/beta/dev and reports the worst tier that breaks,
- for any broken/missing contract, traces one hop to where the logic relocated and proposes a new watch-target stub,
- returns the synthesized report; the workflow subagents cannot write under `.workflow/`, so persist the returned `report` to `.workflow/upstream/zotero_upstream_deep_verify.md` yourself.

Use its output to decide:

- broken on **release/beta** → real fix → `/milestone-tdd milestone=M###`.
- broken only on **dev/main** → `radar` → add the proposed new target(s) to the watchlist, `regenerate`, no product change.
- holds on all tiers → the anchor body churned without behavioral impact; record and move on.

The workflow is read-only w.r.t. product code; it only writes the deep-verify report and informs watchlist edits you make in this skill.

## Sync-Watchlist Mode

1. Acquire the PR diff into `/tmp/zoplicate-upstream-pr.diff`.
2. Run:

```bash
uv run python scripts/ci/check_zotero_upstream.py --sync-watch-targets-from-pr-diff /tmp/zoplicate-upstream-pr.diff --reference-dir .references/zotero --update
```

3. Run:

```bash
uv run python scripts/ci/check_stop.py
```

4. Review the resulting diff. Ensure all writes are limited to the allowed workflow metadata paths listed above.

Automatic watchlist behavior:

- If a local dependency path disappeared and no remaining local dependency points to the same upstream anchor, remove that target.
- If a local file moved, update `local_dependency_paths` without changing the upstream anchor.
- If a new Zotero private API or chrome module dependency is detected, add a target with `risk_level: "medium"` and `needs_manual_mapping: true` unless the upstream anchor can be mapped reliably.
- If the upstream anchor is ambiguous, keep `needs_manual_mapping: true` and require manual confirmation in the report or milestone acceptance.

When you add or repair a target by hand, also fill `contracts` (what Zoplicate depends on) and `cascade_hints` (where relocated logic may go). A target without contracts cannot be deep-verified.

## Regenerate Mode

Run:

```bash
uv run python scripts/ci/check_zotero_upstream.py --reference-dir .references/zotero --update
uv run python scripts/ci/check_stop.py
```

Then review the generated report and milestone. If a release/beta contract is affected, do not implement the fix here; identify the milestone ID for `/milestone-tdd`. If only `main` drifted, confirm the milestone is `radar`/`planned` and stop.

## Hard Rules

- No direct product fixes in this skill.
- No hidden watchlists outside `zotero_watch_targets.json`.
- No acceptance claims without running the listed checks.
- No guessing upstream anchors when the mapping is ambiguous; set `needs_manual_mapping: true` and trace via the workflow.
- A `main`-only (`radar`) change never justifies a product code edit or a `next` milestone.
- A missing anchor is a refactor until proven a removal — grep the symbol before concluding.
- Keep output actionable and short.
