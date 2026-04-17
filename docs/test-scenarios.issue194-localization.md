# Issue #194 Runtime Localization Smoke Checklist

Purpose: verify enabling Zoplicate does not change Zotero native localized strings to English.

## Preconditions

- Zotero 9 runtime available.
- System or Zotero UI language set to a non-English locale (for example zh-CN or de-DE).
- Clean startup state with Zoplicate disabled.

## Scenario R194-01: Baseline without plugin

1. Start Zotero with Zoplicate disabled.
2. Record UI labels for these locations:
   - Right pane under Info: Attachments, Tags
   - Item context menu under Add attachment: File, Linked File, Web Link
   - Item context menu under Add to Collection: New Collection...
   - Collection context menu: Rename Collection, Move To, Copy To
3. Capture screenshot(s) for baseline evidence.

Expected:
- All labels are shown in the selected non-English locale.

## Scenario R194-02: Enable plugin in same locale

1. Enable Zoplicate.
2. Restart Zotero if needed.
3. Re-check all labels listed in Scenario R194-01.
4. Capture screenshot(s).

Expected:
- Zotero native labels remain localized and do not switch to English.
- Zoplicate menu entries are present and localized via addon keys.

## Scenario R194-03: Disable plugin rollback check

1. Disable Zoplicate.
2. Re-check the same UI labels.

Expected:
- Labels stay localized (no residual drift).

## Scenario R194-04: Fresh session re-enable

1. Close Zotero.
2. Start Zotero again and re-enable Zoplicate.
3. Re-run checks from Scenario R194-02.

Expected:
- No localization drift across sessions.

## Evidence to attach to issue/PR

- Locale used (zh-CN, de-DE, and so on).
- Before/after screenshots for each location.
- Short pass/fail note for each scenario.
