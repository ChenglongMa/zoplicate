import { containsRegularItem, isInDuplicatesPane, refreshItemTree } from "../../shared/zotero";
import { fetchDuplicates } from "../../shared/duplicateQueries";
import { Duplicates } from "./duplicates";

/**
 * Notify handler for the duplicates feature.
 * Contains the business logic for responding to item/trash changes.
 *
 * @param isBulkRunning - callback to check if bulk merge is in progress
 */
export function createDuplicatesNotifyHandler(isBulkRunning: () => boolean) {
  return async function handleDuplicatesNotify(
    event: string,
    type: string,
    ids: number[] | string[],
    extraData: { [key: string]: any },
  ): Promise<void> {
    const precondition = ids && ids.length > 0 && !isBulkRunning();

    if (!precondition) {
      return;
    }

    if (type == "item" && event == "removeDuplicatesMaster" && isInDuplicatesPane()) {
      refreshItemTree();
      return;
    }

    let libraryIDs = [Zotero.getActiveZoteroPane().getSelectedLibraryID()];

    const toRefresh =
      // subset of "modify" event (modification on item data and authors) on regular items
      (extraData && Object.values(extraData).some((data) => data.refreshDuplicates)) ||
      // "add" event on regular items
      (type == "item" && event == "add" && containsRegularItem(ids)) ||
      // "refresh" event on trash
      (type == "trash" && event == "refresh");

    ztoolkit.log("refreshDuplicates", toRefresh);

    if (toRefresh) {
      if (type == "item") {
        libraryIDs = ids.map((id) => Zotero.Items.get(id).libraryID);
      }
      if (type == "trash") {
        libraryIDs = ids as number[];
      }
      const libraryID = libraryIDs[0]; // normally only one libraryID
      const { duplicatesObj } = await fetchDuplicates({ libraryID, refresh: true });
      if (type == "item" && event == "add") {
        await Duplicates.instance.whenItemsAdded(duplicatesObj, ids as number[]);
      }
    }
  };
}
