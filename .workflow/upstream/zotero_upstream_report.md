# Zotero Upstream Watch Report

- Generated: `2026-06-14T08:30:12Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0.5 (release), 9.0 (beta), main (dev)`
- Watchlist changed: `no`
- Baseline existed: `yes`
- Overall severity: `radar`
- Draft milestone: `M015`

## Baseline Advances

- `release` tier advanced `9.0.4` -> `9.0.5`; anchors compared against the prior tier snapshot (not skipped).

## Tier Severity Legend

- `urgent` (release tag): users are affected now -- fix and adapt.
- `scheduled` (release branch / beta): ships next -- pre-adapt before release.
- `radar` (main / dev): future risk only -- track, do not chase yet.

## Changed Targets

| Ref | Role | Severity | Target | Old | New | Status | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `main` | `dev` | `radar` | `collection-tree-row-duplicates-search-object` | `f395136ef22a` | `6d9c9b9ad42f` | `ok -> ok` | `chrome/content/zotero/xpcom/collectionTreeRow.js` |

## Behavioral Contracts To Verify

- `collection-tree-row-duplicates-search-object`:
  - On a duplicates row, getSearchObject() delegates to this.ref.getSearchObject() (Zotero.Duplicates.getSearchObject) for the row's library.
  - The duplicate temp table is dropped on row unload (this.onUnload), the lifecycle Zoplicate's caching compensates for.
  - isDuplicates() and .ref.libraryID remain the row's stable identity surface that Zoplicate reads.

## Artifacts

- Watchlist: `.workflow/upstream/zotero_watch_targets.json`
- Contract: `.workflow/upstream/zotero_upstream_contract.json`
- Report: `.workflow/upstream/zotero_upstream_report.md`
- Draft milestone: `.workflow/milestones/M015.json`

## Next Steps

1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.
2. For each changed target, verify the behavioral contracts on the release tier before touching code.
3. `urgent`/`scheduled` drift: run `/upstream-pr-milestone pr=<pr> mode=review`, then `/milestone-tdd milestone=M###`.
4. `radar`-only drift: track relocated logic via cascade hints; do not modify release-targeting product code yet.
