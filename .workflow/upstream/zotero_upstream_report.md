# Zotero Upstream Watch Report

- Generated: `2026-08-07T05:02:25Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0.6 (release), 9.0 (beta), main (dev)`
- Watchlist changed: `no`
- Baseline existed: `yes`
- Overall severity: `radar`
- Draft milestone: `M017`

## Baseline Advances

- `release` tier advanced `9.0.5` -> `9.0.6`; anchors compared against the prior tier snapshot (not skipped).

## Tier Severity Legend

- `urgent` (release tag): users are affected now -- fix and adapt.
- `scheduled` (release branch / beta): ships next -- pre-adapt before release.
- `radar` (main / dev): future risk only -- track, do not chase yet.

## Changed Targets

| Ref | Role | Severity | Target | Old | New | Status | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `main` | `dev` | `radar` | `item-save-data` | `1c3a71d62308` | `87eea4c8dd98` | `ok -> ok` | `chrome/content/zotero/xpcom/data/item.js` |

## Behavioral Contracts To Verify

- `item-save-data`:
  - _saveData(env) receives env.isNew, env.options.skipNotifier, env.options.notifierQueue, and a mutable env.notifierData that is forwarded to Zotero.Notifier.queue('modify'/'add', 'item', id, env.notifierData) -- Zoplicate injects env.notifierData.refreshDuplicates.
  - this._changed.creators and this._changed.itemData expose which fields changed before save; Zoplicate gates the duplicate-refresh flag on them plus this.isRegularItem().
  - this.parentID is readable/writable inside _saveData before original.call, so Zoplicate can re-parent a child whose parent was trashed (used with DuplicateFinder/DuplicateItems master selection).

## Artifacts

- Watchlist: `.workflow/upstream/zotero_watch_targets.json`
- Contract: `.workflow/upstream/zotero_upstream_contract.json`
- Report: `.workflow/upstream/zotero_upstream_report.md`
- Draft milestone: `.workflow/milestones/M017.json`

## Next Steps

1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.
2. For each changed target, verify the behavioral contracts on the release tier before touching code.
3. `urgent`/`scheduled` drift: run `/upstream-pr-milestone pr=<pr> mode=review`, then `/milestone-tdd milestone=M###`.
4. `radar`-only drift: track relocated logic via cascade hints; do not modify release-targeting product code yet.
