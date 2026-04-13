import { DuplicateFinder } from "../../../db/duplicateFinder";
import { DuplicateItems } from "../../../shared/duplicates/duplicateItems";
import { getPref, MasterItem } from "../../../shared/prefs";
import { patchMethod, type Disposer } from "../../../app/lifecycle";

/**
 * Patch `Zotero.Item.prototype._saveData` to re-parent child items when
 * a parent is trashed, and to queue duplicate refresh notifications on
 * item modifications.
 *
 * Returns a disposer that restores the original method.
 */
export function patchItemSaveData(): Disposer {
  return patchMethod(
    Zotero.Item.prototype,
    "_saveData" as any,
    (original: any) =>
      async function (this: any, event: any) {
        const parentID = this.parentID;
        if (parentID) {
          const parentItem = Zotero.Items.get(parentID);
          ztoolkit.log("Parent item", parentID, "deleted?", parentItem?.deleted);
          if (parentItem && parentItem.deleted) {
            const newParents = await new DuplicateFinder(parentItem).find();

            if (newParents.length > 0) {
              const masterItemPref = getPref("bulk.master.item") as MasterItem;
              const duItems = new DuplicateItems(newParents, masterItemPref);
              // TODO: check if this is correct, should use official API
              // Such as Zotero.Items.moveChildItems, etc.
              this.parentID = duItems.masterItem.id;
            }
          }
        }
        await original.call(this, event);

        const refreshDuplicates =
          !event.isNew &&
          !event.options.skipNotifier &&
          (this._changed.creators !== undefined || this._changed.itemData !== undefined) &&
          this.isRegularItem();
        if (refreshDuplicates) {
          const notifierData = event.notifierData || {};
          notifierData.refreshDuplicates = true;
          Zotero.Notifier.queue("modify", "item", this.id, notifierData, event.options.notifierQueue);
        }
      },
  );
}
