import { describe, expect, test, jest, beforeAll, it, afterAll, afterEach } from "@jest/globals";

describe("Duplicate Maps Test", () => {
  test("Construct Duplicate Maps", () => {
    const ids = [1, 2, 3, 4, 5];
    const duplicatesObj = {
      getSetItemsByItemID: (itemID: number) => [itemID, itemID + 1, itemID + 2],
    };
    const defaultAction = "CANCEL";

    const duplicateMaps = ids.reduce((acc, id) => {
      const existingItemIDs: number[] = duplicatesObj.getSetItemsByItemID(id).filter((i: number) => i !== id);
      if (existingItemIDs.length > 0) {
        acc.set(id, { existingItemIDs, action: defaultAction });
      }
      return acc;
    }, new Map<number, { existingItemIDs: number[]; action: string }>());

    console.log(duplicateMaps);
  });
});
