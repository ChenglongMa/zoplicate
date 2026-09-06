import { NonDuplicatesDB } from "../../../db/nonDuplicates";
import { patchMethod, compositeDisposer, type Disposer } from "../../../app/lifecycle";
import { mergeDifferentTypesEnabled } from "../../../shared/prefs";

async function findCrossTypeISBNDuplicates(libraryID: number, sets: any) {
  try {
    if (!Zotero.ItemFields?.getID || !Zotero.DB?.queryAsync || !sets) return;
    const isbnFieldID = Zotero.ItemFields.getID("ISBN");
    if (!isbnFieldID) return;

    const sql =
      "SELECT itemID, value FROM items JOIN itemData USING (itemID) " +
      "JOIN itemDataValues USING (valueID) " +
      "WHERE libraryID=? AND fieldID=? " +
      "AND itemID NOT IN (SELECT itemID FROM deletedItems)";
    const rows = await Zotero.DB.queryAsync(sql, [libraryID, isbnFieldID]);
    if (!rows || rows.length < 2) return;

    const isbnToItemIDs = new Map<string, number[]>();
    for (const row of rows) {
      const cleanVal = Zotero.Utilities?.cleanISBN
        ? Zotero.Utilities.cleanISBN("" + row.value)
        : ("" + row.value).trim();
      if (!cleanVal) continue;
      const group = isbnToItemIDs.get(cleanVal) ?? [];
      group.push(row.itemID);
      isbnToItemIDs.set(cleanVal, group);
    }

    for (const itemIDs of isbnToItemIDs.values()) {
      if (itemIDs.length >= 2) {
        for (let i = 1; i < itemIDs.length; i++) {
          sets.union({ id: itemIDs[0] }, { id: itemIDs[i] });
        }
      }
    }
  } catch (e) {
    ztoolkit?.log?.("Zoplicate: error finding cross-type ISBN duplicates:", e);
  }
}

/**
 * Patch `Zotero.Duplicates.prototype._findDuplicates` and
 * `Zotero.DisjointSetForest.prototype.union` to exclude non-duplicate pairs.
 *
 * Returns a composite disposer that restores both patches.
 *
 * @param db - NonDuplicatesDB instance
 * @param getNonDuplicatesInstance - callback returning the NonDuplicates singleton
 *   (injected to avoid cross-feature import from integrations into features)
 */
export function patchFindDuplicates(
  db: NonDuplicatesDB,
  getNonDuplicatesInstance: () => { allNonDuplicates: Set<string> },
): Disposer {
  const disposer1 = patchMethod(
    Zotero.Duplicates.prototype,
    "_findDuplicates" as any,
    (original: any) =>
      async function (this: any) {
        const duplicateSets = await db.getNonDuplicates({ libraryID: this.libraryID });
        getNonDuplicatesInstance().allNonDuplicates = new Set(
          duplicateSets.map(({ itemID, itemID2 }) => [itemID, itemID2].sort().join(",")),
        );
        await original.call(this);

        if (mergeDifferentTypesEnabled()) {
          await findCrossTypeISBNDuplicates(this.libraryID, this._sets);
        }
      },
  );

  const disposer2 = patchMethod(
    Zotero.DisjointSetForest.prototype,
    "union" as any,
    (original: any) =>
      function (this: any, x: { id: number }, y: { id: number }) {
        const allNonDuplicates = getNonDuplicatesInstance().allNonDuplicates;
        const pair = [x.id, y.id].sort().join(",");
        if (allNonDuplicates.has(pair)) {
          return;
        }
        original.call(this, x, y);
      },
  );

  return compositeDisposer(disposer1, disposer2);
}
