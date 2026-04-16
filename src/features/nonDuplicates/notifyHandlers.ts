import { NonDuplicatesDB } from "../../db/nonDuplicates";
import type { NotifyHandler } from "../../integrations/zotero/notifier";
import {
  nonDuplicateSyncStore,
  normalizePair,
} from "../../integrations/zotero/syncedSettingsStore";

/**
 * Remove pairs containing any of the given keys from SyncedSettings
 * for the appropriate libraries.
 *
 * Wrapped in try/catch so failures never block local DB cleanup.
 */
async function cleanSyncedSettingsPairs(
  keyInfos: { key: string; libraryID: number }[],
): Promise<void> {
  if (keyInfos.length === 0) return;

  // Group keys by libraryID
  const keysByLibrary = new Map<number, Set<string>>();
  for (const { key, libraryID } of keyInfos) {
    let set = keysByLibrary.get(libraryID);
    if (!set) {
      set = new Set();
      keysByLibrary.set(libraryID, set);
    }
    set.add(key);
  }

  for (const [libraryID, keysToRemove] of keysByLibrary) {
    try {
      const existing = nonDuplicateSyncStore.read(libraryID);
      if (existing.length === 0) continue;

      const filtered = existing.filter(([a, b]) => {
        const [na, nb] = normalizePair(a, b);
        return !keysToRemove.has(na) && !keysToRemove.has(nb);
      });

      if (filtered.length === existing.length) continue; // nothing changed

      if (filtered.length === 0) {
        await nonDuplicateSyncStore.clear(libraryID);
      } else {
        await nonDuplicateSyncStore.write(libraryID, filtered);
      }
    } catch (err) {
      Zotero.debug(
        `[zoplicate] cleanSyncedSettingsPairs failed for library ${libraryID}: ${err}`,
      );
    }
  }
}

/**
 * Handler for when items are deleted: clean up non-duplicate records
 * from both the local DB and SyncedSettings.
 */
export async function whenItemsDeleted(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  // 1. Get keys from local DB BEFORE deleting (items may already be gone from Zotero)
  let keyInfos: { key: string; libraryID: number }[] = [];
  try {
    keyInfos = await NonDuplicatesDB.instance.getKeysForItems(ids);
  } catch (err) {
    Zotero.debug(
      `[zoplicate] getKeysForItems failed: ${err}`,
    );
  }

  // 2. Clean SyncedSettings (wrapped in try/catch to not block local cleanup)
  try {
    await cleanSyncedSettingsPairs(keyInfos);
  } catch (err) {
    Zotero.debug(
      `[zoplicate] SyncedSettings cleanup failed: ${err}`,
    );
  }

  // 3. Delete from local DB (always runs)
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
