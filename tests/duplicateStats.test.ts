/**
 * Tests for getDuplicateStats in src/modules/duplicateStats.ts.
 *
 * CRITICAL: jest.mock() calls must appear before the import of the module
 * under test, to prevent side-effect-laden sibling imports from executing
 * against missing Zotero/ztoolkit/addon globals at import time.
 */

import { jest, describe, expect, test } from "@jest/globals";

// Mock every sibling import that duplicateStats.ts pulls in.
// Paths are relative to the SOURCE file (jest resolves from the importing module).
jest.mock("../src/shared/prefs", () => ({
  showingDuplicateStats: jest.fn(() => false),
}));
jest.mock("../src/shared/locale", () => ({
  getString: jest.fn(() => ""),
  initLocale: jest.fn(),
}));
jest.mock("../src/shared/view", () => ({
  removeSiblings: jest.fn(),
}));
jest.mock("../src/shared/duplicateQueries", () => ({
  fetchAllDuplicates: jest.fn(async () => undefined),
  fetchDuplicates: jest.fn(async () => ({ libraryID: 1, duplicatesObj: {}, duplicateItems: [] })),
}));
jest.mock("../src/shared/zotero", () => ({
  activeCollectionsView: jest.fn(() => undefined),
}));

// Now import the function under test -- safe because siblings are mocked.
import { getDuplicateStats } from "../src/features/duplicates/duplicateStats";

// Helper: build a duplicatesObj with known set mappings.
function makeDuplicatesObj(sets: number[][]) {
  const setMap = new Map<number, number[]>();
  for (const set of sets) {
    for (const id of set) {
      setMap.set(id, set);
    }
  }
  return {
    getSetItemsByItemID: (itemID: number) => setMap.get(itemID) ?? [itemID],
  };
}

describe("getDuplicateStats", () => {
  test("returns zero counts for empty input", () => {
    const obj = makeDuplicatesObj([]);
    const result = getDuplicateStats(obj, []);
    expect(result).toEqual({ total: 0, unique: 0 });
  });

  test("single item counts as one unique group", () => {
    const obj = makeDuplicatesObj([[1]]);
    const result = getDuplicateStats(obj, [1]);
    expect(result).toEqual({ total: 1, unique: 1 });
  });

  test("items in the same duplicate set count as one unique group", () => {
    const obj = makeDuplicatesObj([[1, 2, 3]]);
    const result = getDuplicateStats(obj, [1, 2, 3]);
    expect(result).toEqual({ total: 3, unique: 1 });
  });

  test("items in different sets count as separate unique groups", () => {
    const set1 = [1, 2];
    const set2 = [3, 4];
    const obj = makeDuplicatesObj([set1, set2]);
    const result = getDuplicateStats(obj, [1, 2, 3, 4]);
    expect(result).toEqual({ total: 4, unique: 2 });
  });

  test("complex scenario with mixed set sizes", () => {
    const set1 = [10, 20, 30]; // 3 items, 1 group
    const set2 = [40, 50]; // 2 items, 1 group
    const set3 = [60]; // 1 item, 1 group
    const obj = makeDuplicatesObj([set1, set2, set3]);
    const allItems = [10, 20, 30, 40, 50, 60];
    const result = getDuplicateStats(obj, allItems);
    expect(result).toEqual({ total: 6, unique: 3 });
  });
});
