import { describe, expect, test, beforeEach, jest } from "@jest/globals";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mocks - must be declared before imports
// ---------------------------------------------------------------------------

const invalidateAllMock = jest.fn();
jest.mock("../src/integrations/zotero/menuCache", () => ({
  menuCache: {
    invalidateAll: invalidateAllMock,
    buildKey: jest.fn((ids: number[]) => [...ids].sort((a, b) => a - b).join("-")),
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

const insertNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const deleteNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: {
      insertNonDuplicates: insertNonDuplicatesMock,
      deleteNonDuplicates: deleteNonDuplicatesMock,
    },
  },
}));

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({
  libraryID: 1,
  duplicatesObj: { getSetItemsByItemID: jest.fn(() => []) },
  duplicateItems: [],
}));
jest.mock("../src/shared/duplicateQueries", () => ({
  fetchDuplicates: fetchDuplicatesMock,
  areDuplicates: jest.fn(async () => false),
}));

const refreshItemTreeMock = jest.fn();
const isInDuplicatesPaneMock = jest.fn(() => false);
jest.mock("../src/shared/zotero", () => ({
  isInDuplicatesPane: isInDuplicatesPaneMock,
  refreshItemTree: refreshItemTreeMock,
  debug: jest.fn(),
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
  initLocale: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Setup Zotero globals
// ---------------------------------------------------------------------------

const _Zotero = (globalThis as any).Zotero;

const getSelectedItemsMock = jest.fn(() => [
  { id: 10, libraryID: 1 },
  { id: 20, libraryID: 1 },
]);
const getSelectedLibraryIDMock = jest.fn(() => 1);

_Zotero.getActiveZoteroPane = jest.fn(() => ({
  getSelectedItems: getSelectedItemsMock,
  getSelectedLibraryID: getSelectedLibraryIDMock,
}));
_Zotero.Notifier = {
  trigger: jest.fn<(...args: any[]) => Promise<void>>(async () => undefined),
};
_Zotero.ItemTreeManager = {
  refreshColumns: jest.fn(),
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { toggleNonDuplicates, createNonDuplicateButton, NonDuplicates } from "../src/features/non-duplicates/nonDuplicateActions";

// ---------------------------------------------------------------------------
// Tests - toggleNonDuplicates (relocated from nonDuplicates.test.ts)
// ---------------------------------------------------------------------------

describe("toggleNonDuplicates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("mark with explicit libraryID skips getActiveZoteroPane for library ID", async () => {
    await toggleNonDuplicates("mark", [10, 20], 99);

    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 99);
    // Should NOT call getSelectedLibraryID since we provided libraryID
    expect(getSelectedLibraryIDMock).not.toHaveBeenCalled();
  });

  test("mark without libraryID falls back to getActiveZoteroPane", async () => {
    await toggleNonDuplicates("mark", [10, 20]);

    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 1);
    expect(getSelectedLibraryIDMock).toHaveBeenCalled();
  });

  test("unmark calls deleteNonDuplicates", async () => {
    await toggleNonDuplicates("unmark", [10, 20]);

    expect(deleteNonDuplicatesMock).toHaveBeenCalledWith([10, 20]);
  });

  test("cache invalidation is called after toggle", async () => {
    await toggleNonDuplicates("mark", [10, 20]);

    expect(invalidateAllMock).toHaveBeenCalled();
  });

  test("uses selected items when items param is omitted", async () => {
    await toggleNonDuplicates("mark");

    expect(getSelectedItemsMock).toHaveBeenCalled();
    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 1);
  });
});

// ---------------------------------------------------------------------------
// Tests - createNonDuplicateButton
// ---------------------------------------------------------------------------

describe("createNonDuplicateButton", () => {
  test("returns a TagElementProps with the given id and xul namespace", () => {
    const result = createNonDuplicateButton("test-btn-id");
    expect(result.tag).toBe("button");
    expect(result.id).toBe("test-btn-id");
    expect(result.namespace).toBe("xul");
    expect(result.ignoreIfExists).toBe(true);
  });

  test("sets hidden=false when showing is true (default)", () => {
    const result = createNonDuplicateButton("btn-1");
    expect(result.attributes!.hidden).toBe(false);
  });

  test("sets hidden=true when showing is false", () => {
    const result = createNonDuplicateButton("btn-2", false);
    expect(result.attributes!.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests - NonDuplicates class
// ---------------------------------------------------------------------------

describe("NonDuplicates", () => {
  test("getInstance returns the same singleton instance", () => {
    const a = NonDuplicates.getInstance();
    const b = NonDuplicates.getInstance();
    expect(a).toBe(b);
  });

  test("static button ID constants are correctly derived", () => {
    expect(NonDuplicates.nonDuplicateButtonID).toBe("non-duplicates-button");
    expect(NonDuplicates.innerButtonID).toBe("non-duplicates-button-inner");
    expect(NonDuplicates.externalButtonID).toBe("non-duplicates-button-external");
  });

  test("allNonDuplicates starts as an empty Set", () => {
    const instance = NonDuplicates.getInstance();
    expect(instance.allNonDuplicates).toBeInstanceOf(Set);
    expect(instance.allNonDuplicates.size).toBe(0);
  });

  test("allNonDuplicates can be assigned a new Set", () => {
    const instance = NonDuplicates.getInstance();
    instance.allNonDuplicates = new Set(["1,2", "3,4"]);
    expect(instance.allNonDuplicates.size).toBe(2);
    expect(instance.allNonDuplicates.has("1,2")).toBe(true);
    // Clean up for other tests
    instance.allNonDuplicates = new Set();
  });
});
