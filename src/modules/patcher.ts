import { NonDuplicates } from "./nonDuplicateActions";
import { refreshDuplicateStats } from "./duplicateStats";
import { NonDuplicatesDB } from "../db/nonDuplicates";
import { DuplicateItems } from "./duplicateItems";
import { getPref, MasterItem } from "../utils/prefs";
import { DuplicateFinder } from "../db/duplicateFinder";
import {
  getNeedResetDuplicateSearch,
  setNeedResetDuplicateSearch,
  getDuplicateSearchObj,
  setDuplicateSearchObj,
  getDuplicateSets,
  setDuplicateSets,
} from "../utils/state";

/**
 * Execution order:
 * 1. _findDuplicates
 * 2. getSearchObject
 * 3. _saveData
 */

export function patchFindDuplicates(db: NonDuplicatesDB) {
  const patch = new ztoolkit.Patch();
  patch.setData({
    target: Zotero.Duplicates.prototype,
    funcSign: "_findDuplicates",
    enabled: true,
    patcher: (original: any) =>
      async function (this: any) {
        const duplicateSets = await db.getNonDuplicates({ libraryID: this.libraryID });
        NonDuplicates.getInstance().allNonDuplicates = new Set(
          duplicateSets.map(({ itemID, itemID2 }) => [itemID, itemID2].sort().join(",")),
        );
        await original.call(this);
      },
  });
  patch.setData({
    target: Zotero.DisjointSetForest.prototype,
    funcSign: "union",
    enabled: true,
    patcher: (original) =>
      function (this: any, x: { id: number }, y: { id: number }) {
        const allNonDuplicates = NonDuplicates.getInstance().allNonDuplicates;
        const pair = [x.id, y.id].sort().join(",");
        if (allNonDuplicates.has(pair)) {
          return;
        }
        original.call(this, x, y);
      },
  });
}

export function patchGetSearchObject() {
  const patch = new ztoolkit.Patch();
  patch.setData({
    target: Zotero.Duplicates.prototype,
    funcSign: "getSearchObject",
    enabled: true,
    patcher: (original) =>
      async function (this: any): Promise<Zotero.Search> {
        ztoolkit.log("Get Search Object is called.");
        const libraryID = this._libraryID;
        if (getNeedResetDuplicateSearch()[libraryID] || !getDuplicateSearchObj()[libraryID]) {
          ztoolkit.log("debug flag: Reset duplicate search", libraryID);
          const search = await original.call(this);
          setDuplicateSearchObj(libraryID, search);
          setDuplicateSets(libraryID, this._sets);
          setNeedResetDuplicateSearch(libraryID, false);
          await refreshDuplicateStats(libraryID, this, await search.search());
        }
        this._sets = getDuplicateSets()[libraryID];
        return getDuplicateSearchObj()[libraryID];
      },
  });
}

export function patchItemSaveData() {
  const patch = new ztoolkit.Patch();
  patch.setData({
    target: Zotero.Item.prototype,
    funcSign: "_saveData",
    enabled: true,
    patcher: (original) =>
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
  });
}
