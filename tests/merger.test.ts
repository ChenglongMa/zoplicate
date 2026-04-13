import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import { merge } from "../src/shared/duplicates/merger";
import { createMockItem } from "./__setup__/globals";

/* eslint-disable @typescript-eslint/no-explicit-any */
const _Zotero = (globalThis as any).Zotero;
const _ChromeUtils = (globalThis as any).ChromeUtils;
const _mergeItemsMock = (globalThis as any)._mergeItemsMock;

/**
 * Tests for the merge() function in merger.ts.
 * Verifies JSON field precedence, itemTypeID filtering,
 * ChromeUtils.importESModule call path, and that mergeItems is invoked correctly.
 */

beforeEach(() => {
  _mergeItemsMock.mockClear();
  (_ChromeUtils.importESModule as jest.Mock<any>).mockClear();
  (_Zotero.CollectionTreeCache.clear as jest.Mock<any>).mockClear();
  _mergeItemsMock.mockResolvedValue(undefined);
});

describe("merge - ChromeUtils.importESModule call path", () => {
  test("calls ChromeUtils.importESModule with correct chrome:// path", async () => {
    const master = createMockItem({ id: 1, itemTypeID: 5, json: { title: "M" } });
    const other = createMockItem({ id: 2, itemTypeID: 5, json: { title: "O" } });

    await merge(master, [other]);

    expect(_ChromeUtils.importESModule).toHaveBeenCalledWith(
      "chrome://zotero/content/mergeItems.mjs",
    );
  });

  test("calls mergeItems with (masterItem, otherItems)", async () => {
    const master = createMockItem({ id: 1, itemTypeID: 5, json: { title: "M" } });
    const other1 = createMockItem({ id: 2, itemTypeID: 5, json: {} });
    const other2 = createMockItem({ id: 3, itemTypeID: 5, json: {} });

    await merge(master, [other1, other2]);

    expect(_mergeItemsMock).toHaveBeenCalledTimes(1);
    expect(_mergeItemsMock).toHaveBeenCalledWith(master, [other1, other2]);
  });
});

describe("merge - field precedence", () => {
  test("master fields take precedence over candidate fields", async () => {
    const master = createMockItem({
      id: 1,
      itemTypeID: 5,
      json: { title: "Master Title", author: "Master Author" },
    });
    const other = createMockItem({
      id: 2,
      itemTypeID: 5,
      json: { title: "Other Title", author: "Other Author", abstract: "Other Abstract" },
    });

    await merge(master, [other]);

    expect(master.fromJSON).toHaveBeenCalledTimes(1);
    const mergedJSON = master.fromJSON.mock.calls[0][0];
    expect(mergedJSON.title).toBe("Master Title");
    expect(mergedJSON.author).toBe("Master Author");
    expect(mergedJSON.abstract).toBe("Other Abstract");
  });

  test("candidate fills empty fields that master lacks", async () => {
    const master = createMockItem({
      id: 1,
      itemTypeID: 5,
      json: { title: "Master Title" },
    });
    const other = createMockItem({
      id: 2,
      itemTypeID: 5,
      json: { abstract: "Candidate Abstract", year: "2024" },
    });

    await merge(master, [other]);

    const mergedJSON = master.fromJSON.mock.calls[0][0];
    expect(mergedJSON.title).toBe("Master Title");
    expect(mergedJSON.abstract).toBe("Candidate Abstract");
    expect(mergedJSON.year).toBe("2024");
  });
});

describe("merge - itemTypeID filtering", () => {
  test("filters out items with different itemTypeID", async () => {
    const master = createMockItem({
      id: 1,
      itemTypeID: 5,
      json: { title: "Master" },
    });
    const differentType = createMockItem({
      id: 2,
      itemTypeID: 99,
      json: { title: "Different Type" },
    });

    await merge(master, [differentType]);

    expect(_mergeItemsMock).not.toHaveBeenCalled();
    expect(master.fromJSON).not.toHaveBeenCalled();
  });
});

describe("merge - Zotero API calls", () => {
  test("calls CollectionTreeCache.clear before merge", async () => {
    const master = createMockItem({ id: 1, itemTypeID: 5, json: { title: "M" } });
    const other = createMockItem({ id: 2, itemTypeID: 5, json: { title: "O" } });

    await merge(master, [other]);

    expect(_Zotero.CollectionTreeCache.clear).toHaveBeenCalledTimes(1);
  });

  test("excludes relations, collections, and tags from candidate JSON spread", async () => {
    const master = createMockItem({
      id: 1,
      itemTypeID: 5,
      json: { title: "Master Title" },
    });
    const other = createMockItem({
      id: 2,
      itemTypeID: 5,
      json: {
        title: "Other",
        relations: { "dc:replaces": "http://example.com" },
        collections: ["ABCD1234"],
        tags: [{ tag: "sometag" }],
        abstract: "Other Abstract",
      },
    });

    await merge(master, [other]);

    const mergedJSON = master.fromJSON.mock.calls[0][0];
    expect(mergedJSON.relations).toBeUndefined();
    expect(mergedJSON.collections).toBeUndefined();
    expect(mergedJSON.tags).toBeUndefined();
    expect(mergedJSON.abstract).toBe("Other Abstract");
    expect(mergedJSON.title).toBe("Master Title");
  });
});
