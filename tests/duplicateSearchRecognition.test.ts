import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildDuplicateGroupMap } from "../src/features/duplicates/duplicates";
import { areDuplicates } from "../src/integrations/zotero/duplicateSearch";
import { Action } from "../src/shared/prefs";

const _Zotero = (globalThis as any).Zotero;

function installDuplicateSets(setsByItemID: Record<number, number[]>) {
  const DuplicatesMock = jest.fn(function (this: any, libraryID: number) {
    this.libraryID = libraryID;
    this.getSetItemsByItemID = jest.fn((itemID: number) => setsByItemID[itemID] ?? []);
    this.getSearchObject = jest.fn(async () => ({
      search: jest.fn(async () => Object.keys(setsByItemID).map(Number)),
    }));
  });
  _Zotero.Duplicates = DuplicatesMock;
  return DuplicatesMock;
}

describe("duplicate set construction", () => {
  test("merges overlapping incoming duplicate sets into one normalized group", () => {
    const duplicatesObj = {
      getSetItemsByItemID: jest.fn((itemID: number) => {
        if (itemID === 2) return [1, 2];
        if (itemID === 3) return [2, 3];
        return [];
      }),
    };

    const duplicateMaps = buildDuplicateGroupMap(duplicatesObj, [2, 3], Action.ASK);

    expect(duplicateMaps.size).toBe(1);
    expect(duplicateMaps.get(1)).toEqual({
      itemIDs: [1, 2, 3],
      newItemIDs: [2, 3],
      action: Action.ASK,
    });
  });

  test("keeps disjoint duplicate sets separate and ignores singleton sets", () => {
    const duplicatesObj = {
      getSetItemsByItemID: jest.fn((itemID: number) => {
        if (itemID === 2) return [1, 2];
        if (itemID === 4) return [4, 5];
        if (itemID === 9) return [9];
        return [];
      }),
    };

    const duplicateMaps = buildDuplicateGroupMap(duplicatesObj, [2, 4, 9], Action.DISCARD);

    expect([...duplicateMaps.keys()]).toEqual([1, 4]);
    expect(duplicateMaps.get(1)?.itemIDs).toEqual([1, 2]);
    expect(duplicateMaps.get(4)?.itemIDs).toEqual([4, 5]);
    expect(duplicateMaps.has(9)).toBe(false);
  });
});

describe("areDuplicates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (_Zotero.Items.get as jest.Mock<any>).mockImplementation((input: any) => {
      if (Array.isArray(input)) {
        return input.map((id: number) => ({ id, libraryID: 1 }));
      }
      return { id: input, libraryID: input === 30 ? 2 : 1 };
    });
  });

  test("returns false for fewer than two items", async () => {
    installDuplicateSets({ 10: [10, 20] });

    await expect(areDuplicates([10])).resolves.toBe(false);
  });

  test("returns false when selected items belong to different libraries", async () => {
    installDuplicateSets({ 10: [10, 30] });

    await expect(areDuplicates([10, 30])).resolves.toBe(false);
  });

  test("returns true when all item IDs are in the same Zotero duplicate set", async () => {
    const DuplicatesMock = installDuplicateSets({ 10: [10, 20, 30] });

    await expect(
      areDuplicates(
        [
          { id: 10, libraryID: 7 },
          { id: 20, libraryID: 7 },
          { id: 30, libraryID: 7 },
        ] as any[],
        7,
      ),
    ).resolves.toBe(true);

    expect(DuplicatesMock).toHaveBeenCalledWith(7);
  });

  test("returns false when one item is outside the first item's duplicate set", async () => {
    installDuplicateSets({ 10: [10, 20] });

    await expect(
      areDuplicates([
        { id: 10, libraryID: 1 },
        { id: 20, libraryID: 1 },
        { id: 99, libraryID: 1 },
      ] as any[]),
    ).resolves.toBe(false);
  });
});
