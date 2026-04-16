/**
 * NonDuplicateSyncStore — abstracts Zotero.SyncedSettings for
 * non-duplicate pair storage with normalization, deduplication,
 * and version validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NonDuplicateSyncPayload {
  v: 1;
  pairs: [string, string][];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SETTING_KEY = "zoplicate-nonDuplicatePairs";

// ---------------------------------------------------------------------------
// Helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Normalize a pair so the lexicographically smaller key comes first.
 */
export function normalizePair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Remove duplicate pairs from an array. Both (a,b) and (b,a) are
 * considered duplicates after normalization.
 */
export function dedupPairs(pairs: [string, string][]): [string, string][] {
  const seen = new Set<string>();
  const result: [string, string][] = [];
  for (const [a, b] of pairs) {
    const [na, nb] = normalizePair(a, b);
    const key = `${na}\0${nb}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push([na, nb]);
    }
  }
  return result;
}

/**
 * Compute the union of two pair arrays, normalizing, deduplicating,
 * and sorting the result.
 */
export function unionMergePairs(
  localPairs: [string, string][],
  remotePairs: [string, string][],
): [string, string][] {
  const merged = dedupPairs([...localPairs, ...remotePairs]);
  merged.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return merged;
}

// ---------------------------------------------------------------------------
// Store class
// ---------------------------------------------------------------------------

export class NonDuplicateSyncStore {
  /**
   * Read all non-duplicate pairs from SyncedSettings for the given library.
   * Returns an empty array when the setting is missing, has an unknown
   * schema version, or if get() throws (e.g. UnloadedDataException).
   */
  read(libraryID: number): [string, string][] {
    try {
      const raw = Zotero.SyncedSettings.get(libraryID, SETTING_KEY);
      if (raw == null) return [];

      if (typeof raw !== "object" || raw.v !== 1) {
        Zotero.debug(
          `[zoplicate] SyncedSettings: unknown payload version (${JSON.stringify(raw?.v)}), returning empty`,
        );
        return [];
      }

      const payload = raw as NonDuplicateSyncPayload;
      return payload.pairs.map(([a, b]) => normalizePair(a, b));
    } catch (err) {
      Zotero.debug(
        `[zoplicate] SyncedSettings.get() threw: ${err}; returning empty`,
      );
      return [];
    }
  }

  /**
   * Write the full set of non-duplicate pairs, normalizing and
   * deduplicating before storage.
   */
  async write(libraryID: number, pairs: [string, string][]): Promise<void> {
    const cleaned = dedupPairs(pairs);
    const payload: NonDuplicateSyncPayload = { v: 1, pairs: cleaned };
    await Zotero.SyncedSettings.set(libraryID, SETTING_KEY, payload);
  }

  /**
   * Add a single pair if it does not already exist.
   */
  async addPair(
    libraryID: number,
    key1: string,
    key2: string,
  ): Promise<void> {
    const existing = this.read(libraryID);
    const [na, nb] = normalizePair(key1, key2);
    const alreadyPresent = existing.some(
      ([a, b]) => a === na && b === nb,
    );
    if (alreadyPresent) return;
    existing.push([na, nb]);
    await this.write(libraryID, existing);
  }

  /**
   * Remove a single pair (order-insensitive). No-op if not found.
   */
  async removePair(
    libraryID: number,
    key1: string,
    key2: string,
  ): Promise<void> {
    const existing = this.read(libraryID);
    const [na, nb] = normalizePair(key1, key2);
    const filtered = existing.filter(
      ([a, b]) => !(a === na && b === nb),
    );
    if (filtered.length === existing.length) return; // nothing removed
    await this.write(libraryID, filtered);
  }

  /**
   * Remove the entire setting for the given library.
   */
  async clear(libraryID: number): Promise<void> {
    await Zotero.SyncedSettings.clear(libraryID, SETTING_KEY);
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const nonDuplicateSyncStore = new NonDuplicateSyncStore();
