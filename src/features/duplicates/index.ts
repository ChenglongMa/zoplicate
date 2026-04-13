import type { TagElementProps } from "zotero-plugin-toolkit";
import type { Disposer } from "../../app/lifecycle";
import type { MenuConfig } from "../../integrations/zotero/menuManager";

export { Duplicates } from "./duplicates";
export { registerDuplicateStats, getDuplicateStats, refreshDuplicateStats } from "./duplicateStats";
export { registerButtonsInDuplicatePane, updateDuplicateButtonsVisibilities } from "./duplicatePaneUI";
export { createDuplicatesNotifyHandler } from "./notifyHandlers";
export { collectionMenuConfig } from "./menus";

// ---------------------------------------------------------------------------
// Two-level registration wrappers
// ---------------------------------------------------------------------------

/**
 * Global-level registration for the duplicates feature.
 * Returns the collection menu config for registration by the composition root.
 */
export function registerDuplicatesGlobal(): MenuConfig {
  const { collectionMenuConfig } = require("./menus");
  return collectionMenuConfig();
}

/**
 * Window-level registration for the duplicates feature.
 * Registers duplicate stats, pane buttons, and creates the notify handler.
 *
 * @param win - The main browser window
 * @param bulkButtonFactory - Factory for creating bulk merge buttons (injected to avoid cross-feature import)
 * @param nonDupButtonFactory - Factory for creating non-duplicate buttons (injected to avoid cross-feature import)
 * @param isBulkRunning - Callback to check if bulk merge is in progress
 * @returns A composite disposer that cleans up all window-level resources, plus the notify handler
 */
export async function registerDuplicatesWindow(
  win: Window,
  bulkButtonFactory: (win: Window, id: string) => TagElementProps,
  nonDupButtonFactory: (id: string, showing?: boolean) => TagElementProps,
  isBulkRunning: () => boolean,
): Promise<{ disposer: Disposer; notifyHandler: (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => Promise<void> }> {
  const { registerDuplicateStats } = await import("./duplicateStats");
  const { registerButtonsInDuplicatePane } = await import("./duplicatePaneUI");
  const { createDuplicatesNotifyHandler } = await import("./notifyHandlers");

  const statsDisposer = await registerDuplicateStats(win);

  // DOM buttons cleaned by window destruction -- no disposer needed
  await registerButtonsInDuplicatePane(win, bulkButtonFactory, nonDupButtonFactory);

  const notifyHandler = createDuplicatesNotifyHandler(isBulkRunning);

  return {
    disposer: statsDisposer,
    notifyHandler,
  };
}
