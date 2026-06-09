# Zotero Upstream Watch Report

- Generated: `2026-06-09T12:13:02Z`
- Remote: `https://github.com/zotero/zotero.git`
- Refs: `9.0.4 (release), 9.0 (beta), main (dev)`
- Watchlist changed: `yes`
- Baseline existed: `yes`
- Overall severity: `none`
- Draft milestone: `none`

## Tier Severity Legend

- `urgent` (release tag): users are affected now -- fix and adapt.
- `scheduled` (release branch / beta): ships next -- pre-adapt before release.
- `radar` (main / dev): future risk only -- track, do not chase yet.

## Changed Targets

No upstream anchor hashes changed.

## Artifacts

- Watchlist: `.workflow/upstream/zotero_watch_targets.json`
- Contract: `.workflow/upstream/zotero_upstream_contract.json`
- Report: `.workflow/upstream/zotero_upstream_report.md`
- Draft milestone: `none`

## Next Steps

1. Review this report and `.workflow/upstream/zotero_watch_targets.json`.
2. For each changed target, verify the behavioral contracts on the release tier before touching code.
3. `urgent`/`scheduled` drift: run `/upstream-pr-milestone pr=<pr> mode=review`, then `/milestone-tdd milestone=M###`.
4. `radar`-only drift: track relocated logic via cascade hints; do not modify release-targeting product code yet.
