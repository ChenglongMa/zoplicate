import { isAlive } from "../../app/state";
import { type Disposer } from "../../app/lifecycle";

/**
 * Register Zotero notifier observer.
 * Returns a Disposer that unregisters the observer.
 *
 * Note: This module does NOT import from src/features/.
 * All feature-level dispatch is handled by hooks.ts (the composition root).
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
