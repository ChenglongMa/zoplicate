import { patchMethod, type Disposer } from "../../../app/lifecycle";
import {
  getNeedResetDuplicateSearch,
  setNeedResetDuplicateSearch,
  getDuplicateSearchObj,
  setDuplicateSearchObj,
  getDuplicateSets,
  setDuplicateSets,
  markDuplicateSearchDirty,
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
    "getSearchObject",
    (original: any) =>
      async function (this: any) {
        ztoolkit.log("Get Search Object is called.");
        const libraryID = this._libraryID;

        // If we have a cached search, verify its temp table still exists.
        // On macOS APFS, Zotero's idle backup calls closeDatabase(), which closes the SQLite
        // connection and drops all temporary tables, including the tmpDuplicates_* table
        // created by Zotero.Duplicates.getSearchObject(). If the table is gone, mark the
        // cache dirty so original.call(this) recreates it below.
        if (!getNeedResetDuplicateSearch()[libraryID] && getDuplicateSearchObj()[libraryID]) {
          try {
            const cachedSearch = getDuplicateSearchObj()[libraryID]!;
            const conditions = cachedSearch.getConditions();
            let tmpTable: string | null = null;
            for (const id in conditions) {
              if (conditions[id].condition === "tempTable") {
                tmpTable = conditions[id].value;
                break;
              }
            }
            if (tmpTable) {
              const exists = await Zotero.DB.valueQueryAsync(
                "SELECT COUNT(*) FROM sqlite_temp_master WHERE type='table' AND name=?",
                [tmpTable],
              );
              if (!exists) {
                ztoolkit.log(
                  `Zoplicate: temp table ${tmpTable} no longer exists, rebuilding duplicate search`,
                );
                markDuplicateSearchDirty(libraryID);
              }
            }
          } catch (e) {
            ztoolkit.log(
              "Zoplicate: error checking temp table, rebuilding duplicate search:",
              e,
            );
            markDuplicateSearchDirty(libraryID);
          }
        }

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
