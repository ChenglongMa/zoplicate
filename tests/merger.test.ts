import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import { merge } from "../src/modules/merger";
import { createMockItem } from "./__setup__/globals";

/**
 * Tests for the merge() function in merger.ts.
 * Verifies JSON field precedence, itemTypeID filtering,
 * and that Zotero API calls are made correctly.
 */

beforeEach(() => {
  // Reset mocks between tests (clearMocks is on in config, but be explicit)
  (Zotero.Items.merge as jest.Mock<any>).mockClear();
  (Zotero.CollectionTreeCache.clear as jest.Mock<any>).mockClear();
  (Zotero.Items.merge as jest.Mock<any>).mockResolvedValue(undefined);
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

    // fromJSON should be called with master fields overriding candidate fields
    expect(master.fromJSON).toHaveBeenCalledTimes(1);
    const mergedJSON = master.fromJSON.mock.calls[0][0];
    expect(mergedJSON.title).toBe("Master Title");
    expect(mergedJSON.author).toBe("Master Author");
    // Candidate fills in fields not present in master
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

    // merge should return early -- Items.merge should NOT be called
    expect(Zotero.Items.merge).not.toHaveBeenCalled();
    // fromJSON should also not be called since there are no valid candidates
    expect(master.fromJSON).not.toHaveBeenCalled();
  });
});

describe("merge - Zotero API calls", () => {
  test("calls CollectionTreeCache.clear before merge", async () => {
    const master = createMockItem({ id: 1, itemTypeID: 5, json: { title: "M" } });
    const other = createMockItem({ id: 2, itemTypeID: 5, json: { title: "O" } });

    await merge(master, [other]);

    expect(Zotero.CollectionTreeCache.clear).toHaveBeenCalledTimes(1);
  });

  test("calls Items.merge with master and filtered other items", async () => {
    const master = createMockItem({ id: 1, itemTypeID: 5, json: { title: "M" } });
    const other1 = createMockItem({ id: 2, itemTypeID: 5, json: {} });
    const other2 = createMockItem({ id: 3, itemTypeID: 5, json: {} });

    await merge(master, [other1, other2]);

    expect(Zotero.Items.merge).toHaveBeenCalledTimes(1);
    expect(Zotero.Items.merge).toHaveBeenCalledWith(master, [other1, other2]);
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
    // relations, collections, tags from candidate should be excluded
    expect(mergedJSON.relations).toBeUndefined();
    expect(mergedJSON.collections).toBeUndefined();
    expect(mergedJSON.tags).toBeUndefined();
    // Other fields from candidate should carry through
    expect(mergedJSON.abstract).toBe("Other Abstract");
    // Master fields still take precedence
    expect(mergedJSON.title).toBe("Master Title");
  });
});
