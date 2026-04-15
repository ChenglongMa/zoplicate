import { describe, expect, test, beforeEach, jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks - must be declared before imports
// ---------------------------------------------------------------------------

const insertElementBeforeMock = jest.fn();
(globalThis as any).ztoolkit.UI = {
  insertElementBefore: insertElementBeforeMock,
};

const toggleButtonHiddenMock = jest.fn();
jest.mock("../src/shared/view", () => ({
  toggleButtonHidden: toggleButtonHiddenMock,
}));

const isInDuplicatesPaneMock = jest.fn(() => false);
const getItemsViewMock = jest.fn(() => undefined as any);
const getSelectedItemsMock = jest.fn(() => [] as any[]);
const getSelectedLibraryIDMock = jest.fn(() => 1);
jest.mock("../src/integrations/zotero/windows", () => ({
  isInDuplicatesPane: isInDuplicatesPaneMock,
  getItemsView: getItemsViewMock,
  getSelectedItems: getSelectedItemsMock,
  getSelectedLibraryID: getSelectedLibraryIDMock,
}));

const areDuplicatesMock = jest.fn<(...args: any[]) => Promise<boolean>>(async () => false);
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  areDuplicates: areDuplicatesMock,
  fetchDuplicates: jest.fn(async () => ({
    libraryID: 1,
    duplicatesObj: { getSetItemsByItemID: jest.fn(() => []) },
    duplicateItems: [],
  })),
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
  initLocale: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  BULK_MERGE_BUTTON_ID,
  BULK_MERGE_INNER_BUTTON_ID,
  BULK_MERGE_EXTERNAL_BUTTON_ID,
  NON_DUPLICATE_BUTTON_ID,
  NON_DUPLICATE_INNER_BUTTON_ID,
  NON_DUPLICATE_EXTERNAL_BUTTON_ID,
} from "../src/shared/duplicates/duplicateButtonIDs";

import {
  registerButtonsInDuplicatePane,
  updateDuplicateButtonsVisibilities,
} from "../src/features/duplicates/duplicatePaneUI";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWin(opts: { hasMergeButton?: boolean; hasCustomHead?: boolean } = {}): any {
  const elements: Record<string, any> = {};

  const win: any = {
    document: {
      getElementById: jest.fn((id: string) => elements[id] ?? null),
      querySelector: jest.fn((sel: string) => {
        if (sel === "item-message-pane .custom-head" && opts.hasCustomHead) {
          return { ownerDocument: { defaultView: win } };
        }
        return null;
      }),
    },
  };
  if (opts.hasMergeButton) {
    const parentElement = { ownerDocument: { defaultView: win } };
    elements["zotero-duplicates-merge-button"] = { parentElement };
  }
  return win;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("duplicateButtonIDs", () => {
  test("exports BULK_MERGE_BUTTON_ID with correct value", () => {
    expect(BULK_MERGE_BUTTON_ID).toBe("zoplicate-bulk-merge-button");
  });

  test("exports BULK_MERGE_INNER_BUTTON_ID with correct value", () => {
    expect(BULK_MERGE_INNER_BUTTON_ID).toBe("zoplicate-bulk-merge-button-inner");
  });

  test("exports BULK_MERGE_EXTERNAL_BUTTON_ID with correct value", () => {
    expect(BULK_MERGE_EXTERNAL_BUTTON_ID).toBe("zoplicate-bulk-merge-button-external");
  });

  test("exports NON_DUPLICATE_BUTTON_ID with correct value", () => {
    expect(NON_DUPLICATE_BUTTON_ID).toBe("non-duplicates-button");
  });

  test("exports NON_DUPLICATE_INNER_BUTTON_ID with correct value", () => {
    expect(NON_DUPLICATE_INNER_BUTTON_ID).toBe("non-duplicates-button-inner");
  });

  test("exports NON_DUPLICATE_EXTERNAL_BUTTON_ID with correct value", () => {
    expect(NON_DUPLICATE_EXTERNAL_BUTTON_ID).toBe("non-duplicates-button-external");
  });
});

describe("registerButtonsInDuplicatePane", () => {
  const bulkFactory = jest.fn((_win: any, id: string) => ({ tag: "button" as const, id }));
  const nonDupFactory = jest.fn((_win: any, id: string, _showing?: boolean) => ({ tag: "button" as const, id }));

  beforeEach(() => {
    jest.clearAllMocks();
    isInDuplicatesPaneMock.mockReturnValue(false);
  });

  test("calls factories with correct inner IDs when merge button exists", async () => {
    const win = makeWin({ hasMergeButton: true });
    await registerButtonsInDuplicatePane(win, bulkFactory, nonDupFactory);

    expect(bulkFactory).toHaveBeenCalledWith(expect.anything(), BULK_MERGE_INNER_BUTTON_ID);
    expect(nonDupFactory).toHaveBeenCalledWith(win, NON_DUPLICATE_INNER_BUTTON_ID);
  });

  test("calls factories with correct external IDs when custom head exists", async () => {
    const win = makeWin({ hasCustomHead: true });
    await registerButtonsInDuplicatePane(win, bulkFactory, nonDupFactory);

    expect(bulkFactory).toHaveBeenCalledWith(expect.anything(), BULK_MERGE_EXTERNAL_BUTTON_ID);
    expect(nonDupFactory).toHaveBeenCalledWith(win, NON_DUPLICATE_EXTERNAL_BUTTON_ID);
  });

  test("calls insertElementBefore for both panes when both anchors exist", async () => {
    const win = makeWin({ hasMergeButton: true, hasCustomHead: true });
    await registerButtonsInDuplicatePane(win, bulkFactory, nonDupFactory);

    expect(insertElementBeforeMock).toHaveBeenCalledTimes(2);
  });

  test("does not call insertElementBefore when no anchors found", async () => {
    const win = makeWin({});
    await registerButtonsInDuplicatePane(win, bulkFactory, nonDupFactory);

    expect(insertElementBeforeMock).not.toHaveBeenCalled();
  });
});

describe("updateDuplicateButtonsVisibilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSelectedItemsMock.mockReturnValue([
      { id: 10, libraryID: 1 },
      { id: 20, libraryID: 1 },
    ]);
    getSelectedLibraryIDMock.mockReturnValue(1);
  });

  test("calls toggleButtonHidden with correct IDs", async () => {
    isInDuplicatesPaneMock.mockReturnValue(false);
    const win = makeWin();
    await updateDuplicateButtonsVisibilities(win);

    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      true,
      BULK_MERGE_INNER_BUTTON_ID,
      BULK_MERGE_EXTERNAL_BUTTON_ID,
    );
    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      true,
      NON_DUPLICATE_INNER_BUTTON_ID,
      NON_DUPLICATE_EXTERNAL_BUTTON_ID,
    );
  });

  test("shows bulk buttons in duplicates pane with rows", async () => {
    isInDuplicatesPaneMock.mockReturnValue(true);
    getItemsViewMock.mockReturnValue({ rowCount: 5 });
    areDuplicatesMock.mockResolvedValue(false);
    const win = makeWin();
    await updateDuplicateButtonsVisibilities(win);

    // Bulk merge buttons should be shown (hidden=false)
    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      false,
      BULK_MERGE_INNER_BUTTON_ID,
      BULK_MERGE_EXTERNAL_BUTTON_ID,
    );
    // Non-duplicate buttons should still be hidden
    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      true,
      NON_DUPLICATE_INNER_BUTTON_ID,
      NON_DUPLICATE_EXTERNAL_BUTTON_ID,
    );
  });

  test("shows non-duplicate buttons when areDuplicates returns true", async () => {
    isInDuplicatesPaneMock.mockReturnValue(true);
    getItemsViewMock.mockReturnValue({ rowCount: 5 });
    areDuplicatesMock.mockResolvedValue(true);
    const win = makeWin();
    await updateDuplicateButtonsVisibilities(win);

    // Both should be shown
    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      false,
      BULK_MERGE_INNER_BUTTON_ID,
      BULK_MERGE_EXTERNAL_BUTTON_ID,
    );
    expect(toggleButtonHiddenMock).toHaveBeenCalledWith(
      win,
      false,
      NON_DUPLICATE_INNER_BUTTON_ID,
      NON_DUPLICATE_EXTERNAL_BUTTON_ID,
    );
  });
});
