import { Duplicates, processDuplicates } from "./duplicates";
import { getPref, Action } from "../utils/prefs";

export class Notifier {
  static async whenItemsAdded(duplicatesObj: { getSetItemsByItemID(itemID: number): number[] }, ids: Array<number>) {
    const defaultAction = getPref("duplicate.default.action") as Action;
    if (defaultAction === Action.CANCEL || ids.length === 0) {
      return;
    }

    const duplicateMaps = ids.reduce((acc, id) => {
      const existingItemIDs: number[] = duplicatesObj.getSetItemsByItemID(id).filter((i: number) => i !== id);
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
    await processDuplicates(duplicateMaps);
  }

  static registerNotifier() {
    const callback = {
      notify: async (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier(notifierID);
          return;
        }
        await addon.hooks.onNotify(event, type, ids, extraData);
      },
    };

    // Register the callback in Zotero as an item observer
    const notifierID = Zotero.Notifier.registerObserver(callback, [
      "collection",
      "search",
      "share",
      "share-items",
      "item",
      "file",
      "collection-item",
      "item-tag",
      "tag",
      "setting",
      "group",
      "trash",
      "bucket",
      "relation",
      "feed",
      "feedItem",
      "sync",
      "api-key",
      "tab",
    ]);

    // Unregister callback when the window closes (important to avoid a memory leak)
    window.addEventListener(
      "unload",
      (e: Event) => {
        this.unregisterNotifier(notifierID);
      },
      false,
    );
  }

  private static unregisterNotifier(notifierID: string) {
    Zotero.Notifier.unregisterObserver(notifierID);
  }
}
