/**
 * syncListener — registers an onSyncDownload listener that reconciles
 * non-duplicate pairs between SyncedSettings and the local DB.
 */

import {
  SETTING_KEY,
  unionMergePairs,
  type NonDuplicateSyncPayload,
} from "../../integrations/zotero/syncedSettingsStore";
import { refreshLocalFromSync } from "./syncRefresh";

/**
 * Extract pairs from a SyncedSettings payload, returning [] for
 * null/undefined/malformed values.
 */
function extractPairs(value: any): [string, string][] {
  if (value == null) return [];
  if (typeof value !== "object" || value.v !== 1) return [];
  if (!Array.isArray(value.pairs)) return [];
  return value.pairs as [string, string][];
}

/**
 * Register an onSyncDownload listener for the non-duplicate pairs setting.
 *
 * Returns a disposer function. Because upstream Zotero has no
 * removeListener API, disposal is flag-based: calling the disposer
 * sets a boolean that causes the callback to become a no-op.
 */
export function registerSyncListener(libraryID: number): () => void {
  let disposed = false;

  const callback = async (
    oldValue: any,
    newValue: any,
    conflict: boolean,
  ): Promise<void> => {
    if (disposed) return;

    try {
      if (!conflict) {
        // Simple download: apply the new remote pairs to local DB
        const pairs = extractPairs(newValue);
        await refreshLocalFromSync(libraryID, pairs);
      } else {
        // Conflict: oldValue = previous local (unsaved), newValue = remote (already persisted)
        const localPairs = extractPairs(oldValue);
        const remotePairs = extractPairs(newValue);
        const merged = unionMergePairs(localPairs, remotePairs);

        // Write back the merged result with version=0 to prevent
        // re-triggering onSyncDownload (Zotero guards on version > 0)
        const payload: NonDuplicateSyncPayload = { v: 1, pairs: merged };
        await Zotero.SyncedSettings.set(
          libraryID,
          SETTING_KEY,
          payload,
          0,
        );

        // Refresh local DB with the merged pairs
        await refreshLocalFromSync(libraryID, merged);
      }
    } catch (err) {
      Zotero.debug(
        `[zoplicate] syncListener error: ${err}`,
      );
    }
  };

  Zotero.SyncedSettings.onSyncDownload.addListener(
    libraryID,
    SETTING_KEY,
    callback,
  );

  return () => {
    disposed = true;
  };
}
