import { describe, expect, test, jest, beforeAll, it, afterAll, afterEach, beforeEach } from "@jest/globals";

describe("duplicateItems", () => {
  const dateAdded = [1, 2, 3, 4, 5];
  const usedFields = [
    { getUsedFields: () => ["title", "author"] },
    { getUsedFields: () => ["title", "author", "date"] },
    { getUsedFields: () => ["title", "author", "date", "url"] },
  ];

  test("Compare function", async () => {
    const compareFn = (a: number, b: number) => (a < b ? 1 : -1);
    const sorted = dateAdded.sort(compareFn);
    expect(sorted).toEqual([5, 4, 3, 2, 1]);
  });

  test("Compare Length Function", async () => {
    const compareFn = (a: { getUsedFields: () => string[] }, b: { getUsedFields: () => string[] }) => a.getUsedFields().length - b.getUsedFields().length;
    const sorted = usedFields.sort(compareFn);
    const sortedFieldsLength = sorted.map((item) => item.getUsedFields().length);
    expect(sortedFieldsLength).toEqual([2, 3, 4]);
  });
});
