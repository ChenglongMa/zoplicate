import type { Disposer } from "../../app/lifecycle";
import type { MenuConfig } from "../../integrations/zotero/menuManager";
import { NonDuplicatesDB } from "../../db/nonDuplicates";

export { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./nonDuplicates";
export { toggleNonDuplicates, createNonDuplicateButton, NonDuplicates } from "./nonDuplicateActions";
export { whenItemsDeleted } from "./notifyHandlers";
export { itemMenuConfig } from "./menus";

// ---------------------------------------------------------------------------
// Two-level registration wrappers
// ---------------------------------------------------------------------------

/**
 * Global-level registration for the non-duplicates feature.
 * Returns the item menu config for registration by the composition root.
 */
export function registerNonDuplicatesGlobal(): MenuConfig {
  const { itemMenuConfig } = require("./menus");
  return itemMenuConfig();
}

/**
 * Window-level registration for the non-duplicates feature.
 * Registers the non-duplicates item pane section and creates a notify handler
 * for whenItemsDeleted.
 *
 * @param win - The main browser window (unused currently but kept for API symmetry)
 * @returns An object containing a disposer and a delete notify handler
 */
export async function registerNonDuplicatesWindow(
  _win: Window,
): Promise<{ disposer: Disposer; deleteHandler: (ids: number[]) => Promise<void> }> {
  const { registerNonDuplicatesSection, unregisterNonDuplicatesSection } = await import("./nonDuplicates");
  const { whenItemsDeleted } = await import("./notifyHandlers");

  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();
  registerNonDuplicatesSection(nonDuplicatesDB);

  return {
    disposer: () => {
      unregisterNonDuplicatesSection();
    },
    deleteHandler: whenItemsDeleted,
  };
}
