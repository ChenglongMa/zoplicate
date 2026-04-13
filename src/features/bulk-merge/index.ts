import type { Disposer } from "../../app/lifecycle";

export { BulkDuplicates } from "./bulkDuplicates";

// ---------------------------------------------------------------------------
// Two-level registration wrapper
// ---------------------------------------------------------------------------

/**
 * Window-level registration for the bulk-merge feature.
 * Registers UI elements (collection/item listeners) on the given window.
 *
 * @param win - The main browser window
 * @param updateVisibilities - Callback to update duplicate button visibilities
 * @returns A disposer that removes the listeners
 */
export function registerBulkMergeWindow(
  win: Window,
  updateVisibilities: (win: Window) => Promise<void>,
): Disposer {
  const { BulkDuplicates } = require("./bulkDuplicates");
  return BulkDuplicates.instance.registerUIElements(win, updateVisibilities);
}
