import { NonDuplicatesDB } from "../../db/nonDuplicates";
import type { NotifyHandler } from "../../integrations/zotero/notifier";

/**
 * Handler for when items are deleted: clean up non-duplicate records
 * from the local DB.
 */
export async function whenItemsDeleted(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await NonDuplicatesDB.instance.deleteRecords(...ids);
}

export function createNonDuplicatesNotifyHandler(): NotifyHandler {
  return async (event, type, ids) => {
    const isDeleted = type == "item" && event == "delete" && ids.length > 0;
    if (!isDeleted) {
      return;
    }
    await whenItemsDeleted(ids as number[]);
  };
}
