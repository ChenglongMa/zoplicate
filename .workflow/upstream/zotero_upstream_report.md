# Zotero Upstream Watch Report

- Generated: `2026-06-09T06:58:19Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0, main`
- Watchlist changed: `no`
- Baseline existed: `yes`
- Draft milestone: `M014`

## Changed Targets

| Ref | Target | Old | New | Status | Source |
| --- | --- | --- | --- | --- | --- |
| `main` | `collection-tree-render-item` | `76c638339b87` | `55458a31bff8` | `ok -> ok` | `chrome/content/zotero/collectionTree.jsx` |
| `main` | `collection-tree-row-duplicates-search-object` | `b5db26c1e731` | `f395136ef22a` | `ok -> ok` | `chrome/content/zotero/xpcom/collectionTreeRow.js` |
| `main` | `duplicates-merge-pane-merge` | `1909ccefdd7b` | `0b280ce4ae56` | `ok -> ok` | `chrome/content/zotero/elements/duplicatesMergePane.js` |
| `main` | `duplicates-merge-pane-set-items` | `e3714f202a30` | `978112b1ca0b` | `ok -> ok` | `chrome/content/zotero/elements/duplicatesMergePane.js` |
| `main` | `duplicates-merge-pane-set-master` | `5ef6d6b8d694` | `3f6be4391630` | `ok -> ok` | `chrome/content/zotero/elements/duplicatesMergePane.js` |
| `main` | `item-tree-duplicate-selection` | `4a78905c6d91` | `missing` | `ok -> missing` | `` |

## Artifacts

- Watchlist: `.workflow/upstream/zotero_watch_targets.json`
- Contract: `.workflow/upstream/zotero_upstream_contract.json`
- Report: `.workflow/upstream/zotero_upstream_report.md`
- Draft milestone: `.workflow/milestones/M014.json`

## Next Steps

1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.
2. If a draft milestone was generated, run `/upstream-pr-milestone pr=<pr> mode=review` before `/milestone-tdd`.
3. If the PR changes Zoplicate's Zotero-facing dependencies, run `/upstream-pr-milestone pr=<pr> mode=sync-watchlist`.
