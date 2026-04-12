import { describe, expect, test, beforeEach } from "@jest/globals";
import { menuCache } from "../src/modules/menuCache";

describe("menuCache", () => {
  beforeEach(() => {
    menuCache.invalidateAll();
  });

  test("get returns undefined for cache miss", () => {
    expect(menuCache.get("1-2-3")).toBeUndefined();
  });

  test("set and get round-trip", () => {
    const entry = { isNonDuplicate: true, isDuplicateSet: false };
    menuCache.set("1-2", entry);
    expect(menuCache.get("1-2")).toEqual(entry);
  });

  test("set overwrites existing entry", () => {
    menuCache.set("5-6", { isNonDuplicate: false, isDuplicateSet: true });
    menuCache.set("5-6", { isNonDuplicate: true, isDuplicateSet: true });
    expect(menuCache.get("5-6")).toEqual({ isNonDuplicate: true, isDuplicateSet: true });
  });

  test("invalidate removes a single key", () => {
    menuCache.set("1-2", { isNonDuplicate: true, isDuplicateSet: false });
    menuCache.set("3-4", { isNonDuplicate: false, isDuplicateSet: true });
    menuCache.invalidate("1-2");
    expect(menuCache.get("1-2")).toBeUndefined();
    expect(menuCache.get("3-4")).toEqual({ isNonDuplicate: false, isDuplicateSet: true });
  });

  test("invalidateAll clears all entries", () => {
    menuCache.set("1-2", { isNonDuplicate: true, isDuplicateSet: false });
    menuCache.set("3-4", { isNonDuplicate: false, isDuplicateSet: true });
    menuCache.invalidateAll();
    expect(menuCache.get("1-2")).toBeUndefined();
    expect(menuCache.get("3-4")).toBeUndefined();
  });

  test("buildKey sorts item IDs to produce a stable key", () => {
    const key1 = menuCache.buildKey([3, 1, 2]);
    const key2 = menuCache.buildKey([2, 1, 3]);
    expect(key1).toBe(key2);
    expect(key1).toBe("1-2-3");
  });

  test("buildKey with single item", () => {
    expect(menuCache.buildKey([42])).toBe("42");
  });

  test("invalidate on non-existent key is a no-op", () => {
    menuCache.set("1-2", { isNonDuplicate: true, isDuplicateSet: false });
    menuCache.invalidate("999-888");
    expect(menuCache.get("1-2")).toEqual({ isNonDuplicate: true, isDuplicateSet: false });
  });
});
