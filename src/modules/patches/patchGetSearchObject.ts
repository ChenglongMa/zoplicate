import { refreshDuplicateStats } from "../duplicateStats";
import { patchMethod, type Disposer } from "../../lifecycle";
import {
  getNeedResetDuplicateSearch,
  setNeedResetDuplicateSearch,
  getDuplicateSearchObj,
  setDuplicateSearchObj,
  getDuplicateSets,
  setDuplicateSets,
} from "../../utils/state";

/**
 * Patch `Zotero.Duplicates.prototype.getSearchObject` to cache search results
 * and refresh duplicate statistics.
 *
 * Returns a disposer that restores the original method.
 */
export function patchGetSearchObject(): Disposer {
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
