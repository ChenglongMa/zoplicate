/**
 * refreshLocalFromSync — reconcile local non-duplicate DB with
 * the key-based pairs received from SyncedSettings.
 */

import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { normalizePair } from "../../integrations/zotero/syncedSettingsStore";

/**
 * Resolve a Zotero item key to its local itemID.
 * Returns undefined when the key cannot be resolved (item deleted or not synced yet).
 */
async function resolveKey(
  libraryID: number,
  key: string,
): Promise<{ id: number; key: string } | undefined> {
  try {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
    if (!item || !item.id) return undefined;
    return { id: item.id, key };
  } catch {
    return undefined;
  }
}

/**
 * Given a libraryID and the remote set of key pairs, diff against
 * the local DB and insert new / remove stale pairs.
 */
export async function refreshLocalFromSync(
  libraryID: number,
  remotePairs: [string, string][],
): Promise<void> {
  const db = NonDuplicatesDB.instance;

  // 1. Read current local key pairs for this library
  const localKeyPairs = await db.getNonDuplicateKeys({ libraryID });

  // 2. Build sets for fast lookup
  const localSet = new Set<string>(
    localKeyPairs.map((kp) => {
      const [a, b] = normalizePair(kp.key1, kp.key2);
      return `${a}\0${b}`;
    }),
  );

  const remoteNormalized = remotePairs.map(([a, b]) => normalizePair(a, b));
  const remoteSet = new Set<string>(
    remoteNormalized.map(([a, b]) => `${a}\0${b}`),
  );

  // 3. Pairs to add (in remote but not in local)
  const toAdd = remoteNormalized.filter(
    ([a, b]) => !localSet.has(`${a}\0${b}`),
  );

  // 4. Pairs to remove (in local but not in remote)
  const toRemove = localKeyPairs.filter((kp) => {
    const [a, b] = normalizePair(kp.key1, kp.key2);
    return !remoteSet.has(`${a}\0${b}`);
  });

  // 5. Resolve keys to itemIDs and insert
  for (const [keyA, keyB] of toAdd) {
    const itemA = await resolveKey(libraryID, keyA);
    const itemB = await resolveKey(libraryID, keyB);
    if (!itemA || !itemB) continue; // skip unresolvable
    await db.insertNonDuplicatePair(itemA.id, itemB.id, libraryID);
  }

  // 6. Resolve stale pairs and delete
  for (const kp of toRemove) {
    const itemA = await resolveKey(libraryID, kp.key1);
    const itemB = await resolveKey(libraryID, kp.key2);
    if (itemA && itemB) {
      await db.deleteNonDuplicatePair(itemA.id, itemB.id);
    }
  }
}
