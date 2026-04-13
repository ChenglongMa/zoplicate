import { patchMethod, type Disposer } from "../../../app/lifecycle";
import {
  getNeedResetDuplicateSearch,
  setNeedResetDuplicateSearch,
  getDuplicateSearchObj,
  setDuplicateSearchObj,
  getDuplicateSets,
  setDuplicateSets,
} from "../../../app/state";

/**
 * Patch `Zotero.Duplicates.prototype.getSearchObject` to cache search results
 * and refresh duplicate statistics.
 *
 * @param refreshDuplicateStats - callback to refresh stats after search reset;
 *   injected from the composition root to avoid cross-layer imports.
 * Returns a disposer that restores the original method.
 */
export function patchGetSearchObject(
  refreshDuplicateStats: (libraryID: number, duplicatesObj: any, searchResultIDs: number[]) => Promise<void>,
): Disposer {
  return patchMethod(
    Zotero.Duplicates.prototype,
    "getSearchObject" as any,
    (original: any) =>
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
  );
}
