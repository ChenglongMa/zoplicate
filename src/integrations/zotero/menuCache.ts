/**
 * Synchronous cache for menu visibility state.
 * Stores non-duplicate status and duplicate set membership
 * keyed by sorted item IDs.
 */

import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { fetchDuplicates } from "../../shared/duplicateQueries";

export interface MenuCacheEntry {
  isNonDuplicate: boolean;
  isDuplicateSet: boolean;
}

class MenuCache {
  private cache = new Map<string, MenuCacheEntry>();

  /**
   * Build a stable cache key from an array of item IDs.
   * IDs are sorted numerically and joined with hyphens.
   */
  buildKey(itemIDs: number[]): string {
    return [...itemIDs].sort((a, b) => a - b).join("-");
  }

  get(key: string): MenuCacheEntry | undefined {
    return this.cache.get(key);
  }

  set(key: string, entry: MenuCacheEntry): void {
    this.cache.set(key, entry);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

export const menuCache = new MenuCache();

/**
 * Warm the menu visibility cache for a set of item IDs.
 * Queries NonDuplicatesDB and fetchDuplicates to populate the cache.
 */
export async function warmCache(itemIDs: number[], libraryID?: number): Promise<void> {
  if (itemIDs.length < 2) {
    return;
  }

  const key = menuCache.buildKey(itemIDs);
  const isNonDuplicate = await NonDuplicatesDB.instance.existsNonDuplicates(itemIDs);

  const { duplicatesObj } = await fetchDuplicates({ libraryID, refresh: false });
  const duplicateSet = new Set(duplicatesObj.getSetItemsByItemID(itemIDs[0]));
  const isDuplicateSet = itemIDs.every((id) => duplicateSet.has(id));

  menuCache.set(key, { isNonDuplicate, isDuplicateSet });
}
