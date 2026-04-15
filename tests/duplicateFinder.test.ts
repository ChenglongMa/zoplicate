import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { DuplicateFinder } from "../src/db/duplicateFinder";
import { createMockItem } from "./__setup__/globals";

const _Zotero = (globalThis as any).Zotero;

beforeEach(() => {
  jest.clearAllMocks();
  _Zotero.URI = {
    getItemURI: jest.fn((item: any) => `zotero://item/${item.id}`),
  };
  _Zotero.Relations = {
    replacedItemPredicate: "dc:replaces",
    getByPredicateAndObject: jest.fn(async (_type: string, _predicate: string, objectURI: string) => {
      if (objectURI.endsWith("/1")) {
        return [
          createMockItem({ id: 2, deleted: false }),
          createMockItem({ id: 3, deleted: false }),
        ];
      }
      return [];
    }),
  };
  _Zotero.ItemFields = {
    getID: jest.fn((field: string) => {
      const fieldIDs: Record<string, number> = {
        DOI: 1,
        url: 2,
        extra: 3,
        title: 4,
        date: 5,
        ISBN: 6,
      };
      return fieldIDs[field] ?? 99;
    }),
    getTypeFieldsFromBase: jest.fn((base: string) => (base === "title" ? [40] : [50])),
  };
  _Zotero.ItemTypes = {
    getID: jest.fn((type: string) => (type === "book" ? 2 : 1)),
  };
  _Zotero.CreatorTypes = {
    getPrimaryIDForType: jest.fn(() => false),
  };
  _Zotero.DB = {
    queryAsync: jest.fn(async () => [
      { itemID: 2 },
      { itemID: 3 },
    ]),
  };
});

describe("DuplicateFinder", () => {
  test("uses parameter placeholders, not quoted placeholders, for year bounds", async () => {
    const item = createMockItem({
      id: 1,
      itemTypeID: 1,
      displayTitle: "Zoplicate Gamma False Positive",
      fields: {
        title: "Zoplicate Gamma False Positive",
        year: "2022",
        DOI: "",
        url: "",
        extra: "",
      },
    });
    item.libraryID = 7;
    item.getCreators = jest.fn(() => []);

    await expect(new DuplicateFinder(item).find()).resolves.toEqual([2, 3]);

    const queries = (_Zotero.DB.queryAsync as jest.Mock<any>).mock.calls.map((call) => call[0] as string);
    const yearQuery = queries.find((query) => query.includes("SUBSTR(value, 1, 4) >="));

    expect(yearQuery).toContain("SUBSTR(value, 1, 4) >= ?");
    expect(yearQuery).toContain("SUBSTR(value, 1, 4) <= ?");
    expect(yearQuery).not.toContain(">= '?'");
    expect(yearQuery).not.toContain("<= '?'");
  });
});
