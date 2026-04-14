import { beforeEach, describe, expect, test, jest } from "@jest/globals";

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
}));

jest.mock("../src/shared/prefs", () => ({
  getPref: jest.fn(() => "OLDEST"),
}));

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({
  duplicatesObj: { getSetItemsByItemID: jest.fn(() => []) },
  duplicateItems: [],
}));
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
}));

const markDuplicateSearchDirtyMock = jest.fn();
jest.mock("../src/app/state", () => ({
  markDuplicateSearchDirty: markDuplicateSearchDirtyMock,
}));

import { BulkMergeController } from "../src/features/bulkMerge";

function makeSignal() {
  return {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  };
}

function makeWindow(name: string, libraryID: number): any {
  const buttons: Record<string, any> = {
    "zoplicate-bulk-merge-button-inner": {
      setAttribute: jest.fn(),
    },
    "zoplicate-bulk-merge-button-external": {
      setAttribute: jest.fn(),
    },
  };
  return {
    name,
    document: {
      getElementById: jest.fn((id: string) => buttons[id] ?? null),
    },
    ZoteroPane: {
      getSelectedLibraryID: jest.fn(() => libraryID),
      getCollectionTreeRow: jest.fn(() => ({ isDuplicates: () => true })),
      getSelectedItems: jest.fn(() => []),
      collectionsView: { onSelect: makeSignal() },
      itemsView: {
        rowCount: 1,
        onRefresh: makeSignal(),
        onSelect: makeSignal(),
        selection: { clearSelection: jest.fn() },
        waitForLoad: jest.fn(async () => undefined),
      },
    },
    __buttons: buttons,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const progressWindow = {
    createLine: jest.fn(() => progressWindow),
    changeLine: jest.fn(),
    show: jest.fn(() => progressWindow),
    startCloseTimer: jest.fn(),
  };
  (globalThis as any).ztoolkit.ProgressWindow = jest.fn(() => progressWindow);
  (globalThis as any).Zotero.Prompt = {
    BUTTON_TITLE_YES: "yes",
    BUTTON_TITLE_CANCEL: "cancel",
    confirm: jest.fn(() => 0),
  };
  (globalThis as any).Zotero.ItemTreeManager = {
    refreshColumns: jest.fn(),
  };
});

describe("BulkMergeController window scope", () => {
  test("button click uses the originating window library and buttons", async () => {
    const controller = new BulkMergeController();
    const win1 = makeWindow("one", 11);
    const win2 = makeWindow("two", 22);
    const button = controller.createBulkMergeButton(win1, "bulk");
    const listener = button.listeners![0].listener as any;

    await listener({ target: { disabled: false } } as any);

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 11, refresh: false });
    expect(markDuplicateSearchDirtyMock).toHaveBeenCalledWith(11);
    expect(win1.__buttons["zoplicate-bulk-merge-button-inner"].setAttribute).toHaveBeenCalled();
    expect(win2.__buttons["zoplicate-bulk-merge-button-inner"].setAttribute).not.toHaveBeenCalled();
  });

  test("registerUIElements disposer removes the same listener refs", () => {
    const controller = new BulkMergeController();
    const win = makeWindow("one", 11);
    const update = jest.fn(async () => undefined);

    const disposer = controller.registerUIElements(win, update);
    disposer();

    expect(win.ZoteroPane.collectionsView.onSelect.removeListener).toHaveBeenCalledWith(
      win.ZoteroPane.collectionsView.onSelect.addListener.mock.calls[0][0],
    );
    expect(win.ZoteroPane.itemsView.onRefresh.removeListener).toHaveBeenCalledWith(
      win.ZoteroPane.itemsView.onRefresh.addListener.mock.calls[0][0],
    );
    expect(win.ZoteroPane.itemsView.onSelect.removeListener).toHaveBeenCalledWith(
      win.ZoteroPane.itemsView.onSelect.addListener.mock.calls[0][0],
    );
  });
});
