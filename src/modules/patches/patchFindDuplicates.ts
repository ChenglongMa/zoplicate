import { NonDuplicates } from "../nonDuplicateActions";
import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { patchMethod, compositeDisposer, type Disposer } from "../../lifecycle";

/**
 * Patch `Zotero.Duplicates.prototype._findDuplicates` and
 * `Zotero.DisjointSetForest.prototype.union` to exclude non-duplicate pairs.
 *
 * Returns a composite disposer that restores both patches.
 */
export function patchFindDuplicates(db: NonDuplicatesDB): Disposer {
  const disposer1 = patchMethod(
    Zotero.Duplicates.prototype,
    "_findDuplicates" as any,
    (original: any) =>
      async function (this: any) {
        const duplicateSets = await db.getNonDuplicates({ libraryID: this.libraryID });
        NonDuplicates.getInstance().allNonDuplicates = new Set(
          duplicateSets.map(({ itemID, itemID2 }) => [itemID, itemID2].sort().join(",")),
        );
        await original.call(this);
      },
  );

  const disposer2 = patchMethod(
    Zotero.DisjointSetForest.prototype,
    "union" as any,
    (original: any) =>
      function (this: any, x: { id: number }, y: { id: number }) {
        const allNonDuplicates = NonDuplicates.getInstance().allNonDuplicates;
        const pair = [x.id, y.id].sort().join(",");
        if (allNonDuplicates.has(pair)) {
          return;
        }
        original.call(this, x, y);
      },
  );

  return compositeDisposer(disposer1, disposer2);
}
