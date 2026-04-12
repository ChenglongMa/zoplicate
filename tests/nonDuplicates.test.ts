import { describe, expect, test, beforeEach, jest } from "@jest/globals";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mocks - must be declared before imports
// ---------------------------------------------------------------------------

const invalidateAllMock = jest.fn();
jest.mock("../src/modules/menuCache", () => ({
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
jest.mock("../src/utils/duplicates", () => ({
  fetchDuplicates: fetchDuplicatesMock,
  areDuplicates: jest.fn(async () => false),
}));

const refreshItemTreeMock = jest.fn();
const isInDuplicatesPaneMock = jest.fn(() => false);
jest.mock("../src/utils/zotero", () => ({
  isInDuplicatesPane: isInDuplicatesPaneMock,
  refreshItemTree: refreshItemTreeMock,
  debug: jest.fn(),
}));

jest.mock("../src/utils/locale", () => ({
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

import { toggleNonDuplicates } from "../src/modules/nonDuplicates";

// ---------------------------------------------------------------------------
// Tests
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
