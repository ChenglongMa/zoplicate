# Zotero Upstream Watch Report

- Generated: `2026-05-14T06:31:37Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0, main`
- Watchlist changed: `no`
- Baseline existed: `yes`
- Draft milestone: `M014`

## Changed Targets

| Ref | Target | Old | New | Status | Source |
| --- | --- | --- | --- | --- | --- |
| `main` | `collection-tree-render-item` | `76c638339b87` | `103fe82ed613` | `ok -> ok` | `chrome/content/zotero/collectionTree.jsx` |
| `main` | `collection-tree-row-duplicates-search-object` | `b5db26c1e731` | `f395136ef22a` | `ok -> ok` | `chrome/content/zotero/xpcom/collectionTreeRow.js` |
| `main` | `duplicates-merge-pane-merge` | `1909ccefdd7b` | `b6290045fbe2` | `ok -> ok` | `chrome/content/zotero/elements/duplicatesMergePane.js` |
| `main` | `item-tree-duplicate-selection` | `4a78905c6d91` | `missing` | `ok -> missing` | `` |

## Artifacts

- Watchlist: `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`
- Contract: `.claude-workflow/docs/ai/upstream/zotero_upstream_contract.json`
- Report: `.claude-workflow/docs/ai/upstream/zotero_upstream_report.md`
- Draft milestone: `.claude-workflow/docs/ai/milestones/M014.json`

## Next Steps

1. Review this report and `.claude-workflow/docs/ai/upstream/zotero_watch_targets.json`.
2. If a draft milestone was generated, run `/upstream-pr-milestone pr=<pr> mode=review` before `/milestone-loop`.
3. If the PR changes Zoplicate's Zotero-facing dependencies, run `/upstream-pr-milestone pr=<pr> mode=sync-watchlist`.
