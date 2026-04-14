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
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
  areDuplicates: jest.fn(async () => false),
}));

const refreshItemTreeMock = jest.fn();
const isInDuplicatesPaneMock = jest.fn(() => false);
const getSelectedItemsMock = jest.fn((_win?: Window) => [
  { id: 10, libraryID: 1 },
  { id: 20, libraryID: 1 },
]);
const getSelectedLibraryIDMock = jest.fn((_win?: Window) => 1);
jest.mock("../src/integrations/zotero/windows", () => ({
  isInDuplicatesPane: isInDuplicatesPaneMock,
  refreshItemTree: refreshItemTreeMock,
  getSelectedItems: getSelectedItemsMock,
  getSelectedLibraryID: getSelectedLibraryIDMock,
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
  initLocale: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Setup Zotero globals
// ---------------------------------------------------------------------------

const _Zotero = (globalThis as any).Zotero;

const getItemMock = _Zotero.Items.get as jest.Mock<any>;
_Zotero.Notifier = {
  trigger: jest.fn<(...args: any[]) => Promise<void>>(async () => undefined),
};
_Zotero.ItemTreeManager = {
  refreshColumns: jest.fn(),
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  toggleNonDuplicates,
  toggleSelectedNonDuplicates,
  createNonDuplicateButton,
  NonDuplicates,
} from "../src/features/nonDuplicates/nonDuplicateActions";

// ---------------------------------------------------------------------------
// Tests - toggleNonDuplicates (relocated from nonDuplicates.test.ts)
// ---------------------------------------------------------------------------

describe("toggleNonDuplicates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItemMock.mockImplementation((input: any) => {
      if (Array.isArray(input)) {
        return input.map((id: number) => ({ id, libraryID: 77 }));
      }
      return { id: input, libraryID: 77 };
    });
    getSelectedItemsMock.mockReturnValue([
      { id: 10, libraryID: 1 },
      { id: 20, libraryID: 1 },
    ]);
    getSelectedLibraryIDMock.mockReturnValue(1);
  });

  test("mark with explicit libraryID uses it for insert and duplicate refresh", async () => {
    await toggleNonDuplicates("mark", [10, 20], 99);

    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 99);
    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 99, refresh: true });
    // Should NOT call getSelectedLibraryID since we provided libraryID
    expect(getSelectedLibraryIDMock).not.toHaveBeenCalled();
  });

  test("mark with number items resolves libraryID via Zotero.Items.get", async () => {
    await toggleNonDuplicates("mark", [10, 20]);

    expect(getItemMock).toHaveBeenCalledWith(10);
    expect(getItemMock).toHaveBeenCalledWith(20);
    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 77);
    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 77, refresh: true });
    expect(getSelectedLibraryIDMock).not.toHaveBeenCalled();
  });

  test("does nothing when no libraryID can be resolved", async () => {
    getItemMock.mockImplementation((input: any) => ({ id: input }));

    await toggleNonDuplicates("mark", [10, 20]);

    expect(insertNonDuplicatesMock).not.toHaveBeenCalled();
    expect(fetchDuplicatesMock).not.toHaveBeenCalled();
  });

  test("unmark calls deleteNonDuplicates", async () => {
    await toggleNonDuplicates("unmark", [10, 20]);

    expect(deleteNonDuplicatesMock).toHaveBeenCalledWith([10, 20]);
  });

  test("cache invalidation is called after toggle", async () => {
    await toggleNonDuplicates("mark", [10, 20]);

    expect(invalidateAllMock).toHaveBeenCalled();
  });

  test("toggleSelectedNonDuplicates uses selected items from the provided window", async () => {
    const win = {} as Window;
    await toggleSelectedNonDuplicates("mark", win);

    expect(getSelectedItemsMock).toHaveBeenCalledWith(expect.anything());
    expect(getSelectedLibraryIDMock).toHaveBeenCalledWith(expect.anything());
    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 1);
    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
  });
});

// ---------------------------------------------------------------------------
// Tests - createNonDuplicateButton
// ---------------------------------------------------------------------------

describe("createNonDuplicateButton", () => {
  test("returns a TagElementProps with the given id and xul namespace", () => {
    const result = createNonDuplicateButton({} as Window, "test-btn-id");
    expect(result.tag).toBe("button");
    expect(result.id).toBe("test-btn-id");
    expect(result.namespace).toBe("xul");
    expect(result.ignoreIfExists).toBe(true);
  });

  test("sets hidden=false when showing is true (default)", () => {
    const result = createNonDuplicateButton({} as Window, "btn-1");
    expect(result.attributes!.hidden).toBe(false);
  });

  test("sets hidden=true when showing is false", () => {
    const result = createNonDuplicateButton({} as Window, "btn-2", false);
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
