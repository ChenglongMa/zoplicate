# Zoplicate Test Scenarios

This document covers manual and remote-Zotero checks that cannot be fully validated in Jest because they depend on Zotero's import pipeline, chrome/XUL UI, duplicate search implementation, and real merge side effects.

## Local Automated Checks

Run the no-Zotero suite first:

```bash
npm test -- --runInBand
npm run build
```

Useful focused runs while working on duplicate behavior:

```bash
npm test -- duplicates
npm test -- bulkMerge
npm test -- nonDuplicate
npm test -- duplicatePaneUI
```

## Start Zotero For UI Verification

Use a clean development profile/data directory when validating imports and merges.

```bash
npm run zotero:debug
```

Open noVNC from the forwarded port:

```text
http://localhost:6080/vnc.html?host=localhost&port=6080&path=websockify&autoconnect=1&resize=scale
```

Useful diagnostics:

```bash
npm run zotero:screenshot
npm run zotero:logs
rg -n "zoplicate|JavaScript error|TypeError|ReferenceError|Unhandled|Exception|ERROR" logs/zotero-remote
```

Stop the session after testing:

```bash
npm run zotero:stop
```

## Fixture Import

Fixture path:

```text
tests/fixtures/zotero-duplicates-batch.ris
```

The fixture contains:

- Group A: three journal items with the same DOI.
- Group B: two book items with the same ISBN.
- Group C: two journal items with the same title, author, and year but no DOI, intended for non-duplicate marking.

Import steps:

1. Start Zotero with the plugin loaded.
2. In Zotero, choose `File -> Import -> A file`.
3. Select `tests/fixtures/zotero-duplicates-batch.ris`.
4. Import into a new collection to keep the run isolated.
5. Wait for Zotero's import and duplicate search to finish.

## Duplicate Dialog Checks

1. Set Zoplicate's duplicate action preference to ask before importing.
2. Import `zotero-duplicates-batch.ris`.
3. Confirm the Zoplicate duplicate dialog opens with multiple duplicate rows.
4. Set one row to keep the new item, one row to keep the existing item, and one row to cancel.
5. Confirm the default-action checkbox is hidden when rows have mixed actions.
6. Click a column header to apply the same action to all rows.
7. Confirm the default-action checkbox is visible again.
8. Click Apply and verify Zotero keeps the expected master records.

## Repeated Import Checks

1. Import the fixture once and cancel all rows so every item remains available.
2. Import the same fixture again.
3. Confirm the dialog groups repeated imports with the existing duplicate rows instead of creating contradictory actions for overlapping groups.
4. Apply keep-existing and verify the older imported items remain selected after processing.
5. Repeat with keep-new and verify the newest imported items are selected after processing.

## Bulk Merge Checks

1. Import the fixture and cancel all dialog rows.
2. Open Zotero's Duplicate Items pane.
3. Confirm the Zoplicate bulk merge button is visible.
4. Click the bulk merge button and accept the confirmation prompt.
5. Confirm the progress popup updates while groups are processed.
6. Repeat on a fresh profile or restored collection, click the pause button during processing, then choose Resume.
7. Repeat again, choose Cancel, enable restore, and confirm already merged duplicate items are restored from trash.

## Non-Duplicate Checks

1. Import the fixture and cancel all dialog rows.
2. In the Duplicate Items pane, select the two Group C items.
3. Click the mark-as-non-duplicate button.
4. Refresh duplicate search from the Duplicate Items context menu.
5. Confirm Group C is no longer shown as a duplicate pair.
6. Re-import the fixture.
7. Confirm the previously marked Group C pair remains excluded, while newly imported matching items can still be detected against allowed duplicate candidates.
8. Unmark Group C as non-duplicate.
9. Refresh duplicate search and confirm the duplicate relationship is visible again.

## Expected UI Boundaries

Jest covers:

- React dialog state and interactions in jsdom.
- Button visibility and menu configuration with mocked Zotero windows.
- Duplicate processing and merge decisions with mocked Zotero items.
- Non-duplicate cache, DB calls, and patched duplicate union behavior.

Real Zotero is still required for:

- Actual import behavior from RIS.
- Zotero's duplicate search internals.
- XUL/chrome dialog window creation and button placement.
- Real merge side effects, trash restoration, and attachment handling.
- Screenshots and visual regressions in the Zotero shell.
