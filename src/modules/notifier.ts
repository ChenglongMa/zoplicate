import { Duplicates } from "./duplicates";
import { Action } from "../utils/action";
import { getPref } from "../utils/prefs";

export class Notifier {
  static async whenAddItems(ids: Array<number>) {
    const defaultAction = getPref("duplicate.default.action") as Action;
    if (defaultAction === Action.CANCEL || ids.length === 0) {
      return;
    }

    const duplicates = new Zotero.Duplicates(ZoteroPane.getSelectedLibraryID());
    const search = await duplicates.getSearchObject();
    await search.search();

    const duplicateMaps = ids.reduce((acc, id) => {
      const existingItemIDs: number[] = duplicates.getSetItemsByItemID(id).filter((i: number) => i !== id);
      if (existingItemIDs.length > 0) {
        acc.set(id, { existingItemIDs, action: defaultAction });
      }
      return acc;
    }, new Map<number, { existingItemIDs: number[]; action: Action }>());

    if (duplicateMaps.size === 0) return;

    if (defaultAction === Action.ASK) {
      await new Duplicates().showDuplicates(duplicateMaps);
      return;
    }
    await Duplicates.processDuplicates(duplicateMaps);
  }

  static registerNotifier() {
    const callback = {
      notify: async (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier(notifierID);
          return;
        }
        addon.hooks.onNotify(event, type, ids, extraData);
      },
    };

    // Register the callback in Zotero as an item observer
    const notifierID = Zotero.Notifier.registerObserver(callback, ["tab", "item", "file"]);

    // Unregister callback when the window closes (important to avoid a memory leak)
    window.addEventListener(
      "unload",
      (e: Event) => {
        this.unregisterNotifier(notifierID);
      },
      false
    );
  }

  private static unregisterNotifier(notifierID: string) {
    Zotero.Notifier.unregisterObserver(notifierID);
  }
}
