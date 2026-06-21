# Zotero Upstream Watch Report

- Generated: `2026-06-21T08:39:23Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0.5 (release), 9.0 (beta), main (dev)`
- Watchlist changed: `yes`
- Baseline existed: `yes`
- Overall severity: `radar`
- Draft milestone: `M016`

## Tier Severity Legend

- `urgent` (release tag): users are affected now -- fix and adapt.
- `scheduled` (release branch / beta): ships next -- pre-adapt before release.
- `radar` (main / dev): future risk only -- track, do not chase yet.

## Changed Targets

| Ref | Role | Severity | Target | Old | New | Status | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `main` | `dev` | `radar` | `collection-tree-render-item` | `55458a31bff8` | `4ddb6fc3061a` | `ok -> ok` | `chrome/content/zotero/collectionTree.jsx` |
| `main` | `dev` | `radar` | `collection-tree-row-duplicates-search-object` | `6d9c9b9ad42f` | `0b74ab2e9c70` | `ok -> ok` | `chrome/content/zotero/xpcom/collectionTreeRow.js` |
| `main` | `dev` | `radar` | `item-save-data` | `f84711ed44bc` | `1c3a71d62308` | `ok -> ok` | `chrome/content/zotero/xpcom/data/item.js` |
| `main` | `dev` | `radar` | `merge-items` | `3b7ab707962a` | `3d256be1843d` | `ok -> ok` | `chrome/content/zotero/mergeItems.mjs` |

## Behavioral Contracts To Verify

- `collection-tree-render-item`:
  - collectionTree renderItem builds a row whose primary cell is a 'span.cell.label.primary' containing a 'span.cell-text' label node -- Zoplicate queries both selectors to inject a duplicate-count badge.
  - The cell element accepts appended child span nodes (Zoplicate adds a '.number' badge) without renderItem overwriting them on re-render of unchanged rows.
- `collection-tree-row-duplicates-search-object`:
  - On a duplicates row, getSearchObject() delegates to this.ref.getSearchObject() (Zotero.Duplicates.getSearchObject) for the row's library.
  - The duplicate temp table is dropped on row unload (this.onUnload), the lifecycle Zoplicate's caching compensates for.
  - isDuplicates() and .ref.libraryID remain the row's stable identity surface that Zoplicate reads.
- `item-save-data`:
  - _saveData(env) receives env.isNew, env.options.skipNotifier, env.options.notifierQueue, and a mutable env.notifierData that is forwarded to Zotero.Notifier.queue('modify'/'add', 'item', id, env.notifierData) -- Zoplicate injects env.notifierData.refreshDuplicates.
  - this._changed.creators and this._changed.itemData expose which fields changed before save; Zoplicate gates the duplicate-refresh flag on them plus this.isRegularItem().
  - this.parentID is readable/writable inside _saveData before original.call, so Zoplicate can re-parent a child whose parent was trashed (used with DuplicateFinder/DuplicateItems master selection).
- `merge-items`:
  - mergeItems(items, ...) merges a set of duplicate items into a master, handling relations, attachments, and trashing of non-masters.
  - Calling mergeItems is sufficient for Zoplicate's bulk merge; Zoplicate does not reimplement merge side effects.

## Artifacts

- Watchlist: `.workflow/upstream/zotero_watch_targets.json`
- Contract: `.workflow/upstream/zotero_upstream_contract.json`
- Report: `.workflow/upstream/zotero_upstream_report.md`
- Draft milestone: `.workflow/milestones/M016.json`

## Next Steps

1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.
2. For each changed target, verify the behavioral contracts on the release tier before touching code.
3. `urgent`/`scheduled` drift: run `/upstream-pr-milestone pr=<pr> mode=review`, then `/milestone-tdd milestone=M###`.
4. `radar`-only drift: track relocated logic via cascade hints; do not modify release-targeting product code yet.
