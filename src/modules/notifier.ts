import { Duplicates, processDuplicates } from "./duplicates";
import { getPref, Action } from "../utils/prefs";
import { NonDuplicatesDB } from "../db/nonDuplicates";

let notifierID: string | undefined;

export async function whenItemsAdded(
  duplicatesObj: {
    getSetItemsByItemID(itemID: number): number[];
  },
  ids: Array<number>,
) {
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
  processDuplicates(duplicateMaps); // DONT WAIT
}

export async function whenItemsDeleted(ids: number[]) {
  if (ids.length === 0) {
    return;
  }
  await NonDuplicatesDB.instance.deleteRecords(...ids);
}

export function registerNotifier() {
  if (notifierID) unregisterNotifier();

  const callback = {
    notify: async (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => {
      if (!addon?.data.alive) {
        unregisterNotifier();
        return;
      }
      await addon.hooks.onNotify(event, type, ids, extraData);
    },
  };

  // Register the callback in Zotero as an item observer
  notifierID = Zotero.Notifier.registerObserver(callback, [
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
    // "feed",
    // "feedItem",
    "sync",
    "api-key",
    "tab",
  ]);

  // // Unregister callback when the window closes (important to avoid a memory leak)
  // window.addEventListener(
  //   "unload",
  //   (e: Event) => {
  //     unregisterNotifier(notifierID);
  //   },
  //   false,
  // );
}

export function unregisterNotifier() {
  if (!notifierID) return;
  Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
}
