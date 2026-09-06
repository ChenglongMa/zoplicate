import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import { merge } from "../src/shared/duplicates/mergeItems";
import { DuplicateItems } from "../src/shared/duplicates/duplicateItems";
import { MasterItem } from "../src/shared/prefs";
import { createMockItem } from "./__setup__/globals";

const _Zotero = (globalThis as any).Zotero;
const _mergeItemsMock = (globalThis as any)._mergeItemsMock;

beforeEach(() => {
  _mergeItemsMock.mockClear();
  _mergeItemsMock.mockResolvedValue(undefined);
  (_Zotero.Prefs.get as jest.Mock<any>).mockReset();
});

describe("mergeDifferentTypes - DuplicateItems master selection", () => {
  test("when option is disabled, sorts solely by masterItemPref regardless of field loss", () => {
    // duplicate.merge.differentTypes is false
    (_Zotero.Prefs.get as jest.Mock<any>).mockReturnValue(false);

    const olderPreprint = createMockItem({
      id: 1,
      itemTypeID: 2,
      dateAdded: "2024-01-01",
      usedFields: ["title"],
      fields: { title: "Paper" },
    });
    const newerArticle = createMockItem({
      id: 2,
      itemTypeID: 1,
      dateAdded: "2024-02-01",
      usedFields: ["title", "volume", "pages"],
      fields: { title: "Paper", volume: "10", pages: "1-5" },
    });

    const duItems = new DuplicateItems([olderPreprint, newerArticle], MasterItem.OLDEST);
    expect(duItems.masterItem.id).toBe(1);
  });

  test("when option is enabled, selects the type that minimizes field loss", () => {
    // duplicate.merge.differentTypes is true
    (_Zotero.Prefs.get as jest.Mock<any>).mockImplementation((key: string) => {
      if (key.includes("duplicate.merge.differentTypes")) return true;
      return false;
    });

    const olderPreprint = createMockItem({
      id: 1,
      itemTypeID: 2, // preprint lacks volume and pages
      dateAdded: "2024-01-01",
      usedFields: ["title"],
      fields: { title: "Paper" },
    });
    const newerArticle = createMockItem({
      id: 2,
      itemTypeID: 1, // journalArticle can keep volume & pages
      dateAdded: "2024-02-01",
      usedFields: ["title", "volume", "pages"],
      fields: { title: "Paper", volume: "10", pages: "1-5" },
    });

    // Even though preprint is older, journalArticle loses 0 fields, whereas preprint loses 2 fields.
    const duItems = new DuplicateItems([olderPreprint, newerArticle], MasterItem.OLDEST);
    expect(duItems.masterItem.id).toBe(2);
    expect(duItems.otherItems.map((it) => it.id)).toEqual([1]);
  });
});

describe("mergeDifferentTypes - merge function", () => {
  test("when option is enabled, merges items of different types and creates a note for lost fields", async () => {
    (_Zotero.Prefs.get as jest.Mock<any>).mockImplementation((key: string) => {
      if (key.includes("duplicate.merge.differentTypes")) return true;
      return false;
    });

    const noteInstances: any[] = [];
    (_Zotero.Item as jest.Mock<any>).mockImplementation(function (this: any, itemType: string) {
      this.itemType = itemType;
      this.parentItemID = undefined;
      this.libraryID = undefined;
      this._note = "";
      this.setNote = jest.fn((val: string) => {
        this._note = val;
      });
      this.saveTx = jest.fn(async () => {});
      noteInstances.push(this);
      return this;
    });

    // Master is type 2 (preprint)
    const master = createMockItem({
      id: 100,
      itemTypeID: 2,
      json: { title: "My Paper" },
    });

    // Other is type 1 (journalArticle) with volume="42" (which preprint cannot accept)
    const other = createMockItem({
      id: 101,
      itemTypeID: 1,
      usedFields: ["title", "volume"],
      fields: { title: "My Paper", volume: "42" },
      json: { title: "My Paper", volume: "42" },
      displayTitle: "Journal Version",
    });

    await merge(master, [other]);

    // mergeItems was called with both items (not filtered out!)
    expect(_mergeItemsMock).toHaveBeenCalledTimes(1);
    expect(_mergeItemsMock).toHaveBeenCalledWith(master, [other]);

    // A note was created and attached to master item
    expect(noteInstances).toHaveLength(1);
    const note = noteInstances[0];
    expect(note.parentItemID).toBe(100);
    expect(note._note).toContain("Champs non conservés");
    expect(note._note).toContain("Volume");
    expect(note._note).toContain("42");
    expect(note.saveTx).toHaveBeenCalledTimes(1);
  });

  test("when option is enabled and no fields are lost, does not create an empty note", async () => {
    (_Zotero.Prefs.get as jest.Mock<any>).mockImplementation((key: string) => {
      if (key.includes("duplicate.merge.differentTypes")) return true;
      return false;
    });

    const noteInstances: any[] = [];
    (_Zotero.Item as jest.Mock<any>).mockImplementation(function (this: any, itemType: string) {
      this.itemType = itemType;
      noteInstances.push(this);
      return this;
    });

    // Master is type 1 (journalArticle) which supports all fields of other (also type 1 or type 2 title/DOI)
    const master = createMockItem({
      id: 1,
      itemTypeID: 1,
      json: { title: "Paper" },
    });
    const other = createMockItem({
      id: 2,
      itemTypeID: 2,
      usedFields: ["title", "DOI"], // Both supported by type 1
      fields: { title: "Paper", DOI: "10.1234/test" },
      json: { title: "Paper", DOI: "10.1234/test" },
    });

    await merge(master, [other]);

    expect(_mergeItemsMock).toHaveBeenCalledWith(master, [other]);
    expect(noteInstances).toHaveLength(0); // No lost fields, no note
  });

  test("when option is disabled, items with different types are filtered out", async () => {
    (_Zotero.Prefs.get as jest.Mock<any>).mockReturnValue(false);

    const master = createMockItem({
      id: 1,
      itemTypeID: 1,
      json: { title: "Paper" },
    });
    const other = createMockItem({
      id: 2,
      itemTypeID: 2,
      json: { title: "Paper" },
    });

    await merge(master, [other]);

    expect(_mergeItemsMock).not.toHaveBeenCalled();
  });
});
