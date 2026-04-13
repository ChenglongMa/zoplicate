import { NonDuplicatesDB } from "../../db/nonDuplicates";

/**
 * Handler for when items are deleted: clean up non-duplicate records.
 */
export async function whenItemsDeleted(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await NonDuplicatesDB.instance.deleteRecords(...ids);
}
