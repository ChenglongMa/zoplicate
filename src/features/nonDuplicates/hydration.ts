/**
 * hydration — startup bidirectional sync between local non-duplicate DB
 * and SyncedSettings. Bootstraps local pairs to SyncedSettings on first
 * upgrade and imports remote-only pairs to local DB.
 */

import type { NonDuplicatesDB, NonDuplicateKeyPair } from "../../db/nonDuplicates";
import {
  normalizePair,
  type NonDuplicateSyncStore,
} from "../../integrations/zotero/syncedSettingsStore";

/**
 * Hydrate a single library: read local key pairs and remote pairs,
 * compute diff, write local-only to SyncedSettings (bootstrap),
 * import remote-only to local DB.
 */
export async function hydrateLibrary(
  libraryID: number,
  db: NonDuplicatesDB,
  syncStore: NonDuplicateSyncStore,
): Promise<void> {
  // 1. Read local key pairs
  const localKeyPairs = await db.getNonDuplicateKeys({ libraryID });

  // 2. Read remote pairs from SyncedSettings
  const remotePairs = syncStore.read(libraryID);

  // 3. Build normalized sets for fast lookup
  const localNormalized: [string, string][] = localKeyPairs.map((kp) =>
    normalizePair(kp.key1, kp.key2),
  );
  const localSet = new Set<string>(
    localNormalized.map(([a, b]) => `${a}\0${b}`),
  );

  const remoteNormalized: [string, string][] = remotePairs.map(([a, b]) =>
    normalizePair(a, b),
  );
  const remoteSet = new Set<string>(
    remoteNormalized.map(([a, b]) => `${a}\0${b}`),
  );

  // 4. Local-only pairs -> write to SyncedSettings (bootstrap)
  const localOnly = localNormalized.filter(
    ([a, b]) => !remoteSet.has(`${a}\0${b}`),
  );

  if (localOnly.length > 0) {
    // Add local-only pairs to the existing remote pairs
    const allPairs: [string, string][] = [...remoteNormalized, ...localOnly];
    await syncStore.write(libraryID, allPairs);
  }

  // 5. Remote-only pairs -> import to local DB
  const remoteOnly = remoteNormalized.filter(
    ([a, b]) => !localSet.has(`${a}\0${b}`),
  );

  for (const [keyA, keyB] of remoteOnly) {
    try {
      const itemA = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, keyA);
      const itemB = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, keyB);
      if (!itemA || !itemB) continue; // skip unresolvable
      if (typeof itemA === "boolean" || typeof itemB === "boolean") continue;
      await db.insertNonDuplicatePair(itemA.id, itemB.id, libraryID);
    } catch {
      // Skip unresolvable pairs
    }
  }
}

/**
 * Hydrate all non-feed libraries. Enumerates libraries via
 * Zotero.Libraries.getAll(), filters out feeds, and calls
 * hydrateLibrary per library.
 */
export async function hydrateAllLibraries(
  db: NonDuplicatesDB,
  syncStore: NonDuplicateSyncStore,
): Promise<void> {
  try {
    const allLibraries = Zotero.Libraries.getAll();
    for (const lib of allLibraries) {
      if (lib.libraryType === "feed") continue;
      try {
        await hydrateLibrary(lib.libraryID, db, syncStore);
      } catch (err) {
        Zotero.debug(
          `[zoplicate] hydrateLibrary failed for library ${lib.libraryID}: ${err}`,
        );
      }
    }
  } catch (err) {
    Zotero.debug(`[zoplicate] hydrateAllLibraries failed: ${err}`);
  }
}
