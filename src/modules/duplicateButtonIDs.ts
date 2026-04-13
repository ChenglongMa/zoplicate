/**
 * Plain string constants for duplicate-pane button IDs.
 * No class imports -- this module exists to break the circular dependency
 * between bulkDuplicates, nonDuplicateActions, and duplicates.
 */

export const BULK_MERGE_BUTTON_ID = "zoplicate-bulk-merge-button";
export const BULK_MERGE_INNER_BUTTON_ID = BULK_MERGE_BUTTON_ID + "-inner";
export const BULK_MERGE_EXTERNAL_BUTTON_ID = BULK_MERGE_BUTTON_ID + "-external";

export const NON_DUPLICATE_BUTTON_ID = "non-duplicates-button";
export const NON_DUPLICATE_INNER_BUTTON_ID = NON_DUPLICATE_BUTTON_ID + "-inner";
export const NON_DUPLICATE_EXTERNAL_BUTTON_ID = NON_DUPLICATE_BUTTON_ID + "-external";
