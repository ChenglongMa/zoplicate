import { NonDuplicatesDB } from "../db/nonDuplicates";
import { isAlive } from "../utils/state";
import { type Disposer } from "../lifecycle";

export async function whenItemsDeleted(ids: number[]) {
  if (ids.length === 0) {
    return;
  }
  await NonDuplicatesDB.instance.deleteRecords(...ids);
}

/**
 * Register Zotero notifier observer.
 * Returns a Disposer that unregisters the observer.
 *
 * Note: The Plugins.addObserver({ shutdown }) pattern has been removed.
 * The DisposerRegistry in hooks.ts now owns lifecycle cleanup.
 */
export function registerNotifier(): Disposer {
  const callback = {
    notify: async (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => {
      if (!isAlive()) {
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
    "sync",
    "api-key",
    "tab",
  ]);

  return () => {
    Zotero.Notifier.unregisterObserver(notifierID);
  };
}
