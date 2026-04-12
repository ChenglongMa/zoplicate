/**
 * Synchronous cache for menu visibility state.
 * Stores non-duplicate status and duplicate set membership
 * keyed by sorted item IDs.
 */

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
