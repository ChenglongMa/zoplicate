import { fetchDuplicates } from "../../integrations/zotero/duplicateSearch";
import {
  getFirstLiveWindow,
  isInDuplicatesPane,
  isWindowAlive,
  refreshItemTree,
} from "../../integrations/zotero/windows";
import { containsRegularItem } from "../../shared/items";
import { Duplicates } from "./duplicates";

type SchedulePendingAddFlush = (flush: () => Promise<void>) => void;

interface DuplicatesNotifyHandlerOptions {
  schedulePendingAddFlush?: SchedulePendingAddFlush;
}

function defaultSchedulePendingAddFlush(flush: () => Promise<void>) {
  setTimeout(() => {
    void flush().catch((error) => ztoolkit.log("duplicate add processing failed", error));
  }, 0);
}

function getZoteroSyncInProgress(): boolean {
  return Boolean((Zotero as any).Sync?.Runner?.syncInProgress);
}

function getZoteroDB():
  | { inTransaction?: () => boolean; waitForTransaction?: (label?: string) => Promise<void> }
  | undefined {
  return (Zotero as any).DB;
}

async function waitForZoteroDBIdle(): Promise<boolean> {
  const db = getZoteroDB();
  if (!db?.inTransaction) {
    return true;
  }

  while (db.inTransaction()) {
    if (!db.waitForTransaction) {
      return false;
    }
    await db.waitForTransaction("zoplicate duplicate add");
  }

  return true;
}

function toNumericIDs(ids: number[] | string[]): number[] {
  return ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function getLibraryIDsForNotify(type: string, ids: number[] | string[]): number[] {
  if (type === "trash") {
    return uniqueNumbers(toNumericIDs(ids));
  }

  if (type !== "item") {
    return [];
  }

  return uniqueNumbers(
    toNumericIDs(ids)
      .map((id) => Zotero.Items.get(id) as Zotero.Item | false | undefined)
      .filter((item): item is Zotero.Item => Boolean(item))
      .map((item) => item.libraryID),
  );
}

function isRemoteSyncAdd(ids: number[], extraData: Record<string, any>): boolean {
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const data = extraData?.[id];
      return Boolean(data?.skipSelect && data?.skipRenameFile);
    })
  );
}

function getLiveRegularItemIDs(ids: number[], libraryID: number): number[] {
  return ids.filter((id) => {
    const item = Zotero.Items.get(id) as Zotero.Item | false | undefined;
    return Boolean(item && !item.deleted && item.libraryID === libraryID && item.isRegularItem());
  });
}

/**
 * Notify handler for the duplicates feature.
 * Contains the business logic for responding to item/trash changes.
 *
 * @param isBulkRunning - callback to check if bulk merge is in progress
 */
export function createDuplicatesNotifyHandler(
  isBulkRunning: () => boolean,
  getLoadedWindows: () => Window[],
  options: DuplicatesNotifyHandlerOptions = {},
) {
  const schedulePendingAddFlush = options.schedulePendingAddFlush ?? defaultSchedulePendingAddFlush;
  let syncInProgress = getZoteroSyncInProgress();
  let pendingAddFlushScheduled = false;
  const pendingAddedItemIDsByLibrary = new Map<number, Set<number>>();
  const dirtyLibraryIDsDuringSync = new Set<number>();

  const markLibrariesDirtyDuringSync = (libraryIDs: number[]) => {
    libraryIDs.forEach((libraryID) => dirtyLibraryIDsDuringSync.add(libraryID));
  };

  const refreshDirtyLibraries = async (libraryIDs: number[] = []) => {
    const dirtyLibraryIDs = uniqueNumbers([...dirtyLibraryIDsDuringSync, ...libraryIDs]);
    dirtyLibraryIDsDuringSync.clear();
    for (const libraryID of dirtyLibraryIDs) {
      await fetchDuplicates({ libraryID, refresh: true });
    }
  };

  const flushPendingAddedItems = async () => {
    pendingAddFlushScheduled = false;

    if (!(await waitForZoteroDBIdle())) {
      pendingAddFlushScheduled = true;
      schedulePendingAddFlush(flushPendingAddedItems);
      return;
    }

    if (syncInProgress || getZoteroSyncInProgress()) {
      return;
    }

    const pendingEntries = [...pendingAddedItemIDsByLibrary.entries()];
    pendingAddedItemIDsByLibrary.clear();

    for (const [libraryID, itemIDSet] of pendingEntries) {
      const itemIDs = getLiveRegularItemIDs([...itemIDSet], libraryID);
      if (itemIDs.length === 0) {
        continue;
      }

      const { duplicatesObj } = await fetchDuplicates({ libraryID, refresh: true });
      await Duplicates.instance.whenItemsAdded(duplicatesObj, itemIDs, {
        win: getFirstLiveWindow(getLoadedWindows()),
      });
    }
  };

  const schedulePendingAddedItems = (libraryID: number, ids: number[]) => {
    if (!pendingAddedItemIDsByLibrary.has(libraryID)) {
      pendingAddedItemIDsByLibrary.set(libraryID, new Set());
    }

    const pendingIDs = pendingAddedItemIDsByLibrary.get(libraryID)!;
    ids.forEach((id) => pendingIDs.add(id));

    if (pendingAddFlushScheduled) {
      return;
    }

    pendingAddFlushScheduled = true;
    schedulePendingAddFlush(flushPendingAddedItems);
  };

  return async function handleDuplicatesNotify(
    event: string,
    type: string,
    ids: number[] | string[],
    extraData: { [key: string]: any },
  ): Promise<void> {
    if (type === "sync") {
      if (event === "start") {
        syncInProgress = true;
        return;
      }
      if (event === "finish") {
        syncInProgress = false;
        await refreshDirtyLibraries(toNumericIDs(ids));
        if (pendingAddedItemIDsByLibrary.size > 0 && !pendingAddFlushScheduled) {
          pendingAddFlushScheduled = true;
          schedulePendingAddFlush(flushPendingAddedItems);
        }
        return;
      }
    }

    const precondition = ids && ids.length > 0 && !isBulkRunning();

    if (!precondition) {
      return;
    }

    if (type == "item" && event == "removeDuplicatesMaster") {
      for (const win of getLoadedWindows()) {
        if (!isWindowAlive(win)) {
          continue;
        }
        if (isInDuplicatesPane(win)) {
          refreshItemTree(win);
        }
      }
      return;
    }

    const toRefresh =
      // subset of "modify" event (modification on item data and authors) on regular items
      (extraData && Object.values(extraData).some((data) => data.refreshDuplicates)) ||
      // "add" event on regular items
      (type == "item" && event == "add" && containsRegularItem(ids)) ||
      // "refresh" event on trash
      (type == "trash" && event == "refresh");

    ztoolkit.log("refreshDuplicates", toRefresh);

    if (toRefresh) {
      const libraryIDs = getLibraryIDsForNotify(type, ids);
      if (libraryIDs.length === 0) {
        return;
      }
      const libraryID = libraryIDs[0]; // normally only one libraryID

      if (syncInProgress || getZoteroSyncInProgress()) {
        markLibrariesDirtyDuringSync(libraryIDs);
        return;
      }

      const addedItemIDs = toNumericIDs(ids);
      if (type == "item" && event == "add") {
        if (isRemoteSyncAdd(addedItemIDs, extraData)) {
          await fetchDuplicates({ libraryID, refresh: true });
          return;
        }

        schedulePendingAddedItems(libraryID, addedItemIDs);
        return;
      }

      await fetchDuplicates({ libraryID, refresh: true });
    }
  };
}
