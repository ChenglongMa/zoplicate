import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockItem } from "./__setup__/globals";

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>();
const markDuplicateSearchDirtyMock = jest.fn();
const mergeMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const getPrefMock = jest.fn<(...args: any[]) => any>();

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string, options?: any) => (options?.args?.item ? `${key}:${options.args.item}` : key)),
}));

jest.mock("../src/shared/prefs", () => {
  const actual = jest.requireActual("../src/shared/prefs") as typeof import("../src/shared/prefs");
  return {
    ...actual,
    getPref: getPrefMock,
  };
});

jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
}));

jest.mock("../src/app/state", () => ({
  markDuplicateSearchDirty: markDuplicateSearchDirtyMock,
}));

jest.mock("../src/shared/duplicates/mergeItems", () => ({
  merge: mergeMock,
}));

import { BulkMergeController } from "../src/features/bulkMerge";
import { MasterItem } from "../src/shared/prefs";

const _Zotero = (globalThis as any).Zotero;
const _ztoolkit = (globalThis as any).ztoolkit;

function makeProgressWindow() {
  const progressWindow = {
    createLine: jest.fn(() => progressWindow),
    changeLine: jest.fn(),
    show: jest.fn(() => progressWindow),
    startCloseTimer: jest.fn(),
  };
  return progressWindow;
}

function makeWindow(libraryID = 1): any {
  const buttons: Record<string, any> = {
    "zoplicate-bulk-merge-button-inner": { setAttribute: jest.fn() },
    "zoplicate-bulk-merge-button-external": { setAttribute: jest.fn() },
  };
  return {
    document: {
      getElementById: jest.fn((id: string) => buttons[id] ?? null),
    },
    ZoteroPane: {
      getSelectedLibraryID: jest.fn(() => libraryID),
      getCollectionTreeRow: jest.fn(() => ({ isDuplicates: () => true })),
      getSelectedItems: jest.fn(() => []),
      itemsView: { rowCount: 1 },
    },
    __buttons: buttons,
  };
}

function setItems(items: any[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  _Zotero.Items.get = jest.fn((input: number | number[]) => {
    if (Array.isArray(input)) {
      return input.map((id) => itemMap.get(id));
    }
    return itemMap.get(input);
  });
}

function makeItem(id: number, dateAdded: string) {
  return {
    ...createMockItem({ id, dateAdded, displayTitle: `Item ${id}` }),
    libraryID: 1,
    saveTx: jest.fn(async () => undefined),
  };
}

function installDuplicateSearch(groups: Record<number, number[]>, duplicateItems: number[]) {
  fetchDuplicatesMock.mockResolvedValue({
    duplicatesObj: {
      getSetItemsByItemID: jest.fn((itemID: number) => groups[itemID] ?? []),
    },
    duplicateItems,
  });
}

async function clickBulkMergeButton(controller: BulkMergeController, win: any) {
  const button = controller.createBulkMergeButton(win, "bulk");
  const listener = button.listeners![0].listener as any;
  await listener({ target: { disabled: false } });
}

beforeEach(() => {
  jest.clearAllMocks();
  getPrefMock.mockReturnValue(MasterItem.OLDEST);
  _ztoolkit.ProgressWindow = jest.fn(() => makeProgressWindow());
  _Zotero.ItemTreeManager = { refreshColumns: jest.fn() };
  _Zotero.Prompt = {
    BUTTON_TITLE_YES: "yes",
    BUTTON_TITLE_CANCEL: "cancel",
    confirm: jest.fn(() => 0),
  };
});

describe("BulkMergeController bulk processing", () => {
  test("merges each duplicate group once and skips singleton sets", async () => {
    const items = [
      makeItem(1, "2020-01-01 00:00:00"),
      makeItem(2, "2024-01-01 00:00:00"),
      makeItem(3, "2022-01-01 00:00:00"),
      makeItem(4, "2021-01-01 00:00:00"),
      makeItem(5, "2025-01-01 00:00:00"),
    ];
    setItems(items);
    installDuplicateSearch(
      {
        1: [1, 2],
        2: [1, 2],
        3: [3],
        4: [4, 5],
        5: [4, 5],
      },
      [1, 2, 3, 4, 5],
    );

    const win = makeWindow(42);
    await clickBulkMergeButton(new BulkMergeController(), win);

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 42, refresh: false });
    expect(mergeMock).toHaveBeenCalledTimes(2);
    expect(mergeMock).toHaveBeenNthCalledWith(1, items[0], [items[1]]);
    expect(mergeMock).toHaveBeenNthCalledWith(2, items[3], [items[4]]);
    expect(markDuplicateSearchDirtyMock).toHaveBeenCalledWith(42);
  });

  test("resume prompt continues after a paused merge", async () => {
    const items = [
      makeItem(1, "2020-01-01 00:00:00"),
      makeItem(2, "2024-01-01 00:00:00"),
      makeItem(3, "2020-01-01 00:00:00"),
      makeItem(4, "2024-01-01 00:00:00"),
    ];
    setItems(items);
    installDuplicateSearch(
      {
        1: [1, 2],
        3: [3, 4],
      },
      [1, 3],
    );

    const controller = new BulkMergeController();
    const win = makeWindow();
    mergeMock.mockImplementationOnce(async () => {
      (controller as any).setRunning(win, false);
    });

    await clickBulkMergeButton(controller, win);

    expect(_Zotero.Prompt.confirm).toHaveBeenCalledTimes(2);
    expect(mergeMock).toHaveBeenCalledTimes(2);
    expect(mergeMock).toHaveBeenNthCalledWith(2, items[2], [items[3]]);
  });

  test("cancel with restore re-saves already merged items and stops remaining groups", async () => {
    const items = [
      makeItem(1, "2020-01-01 00:00:00"),
      makeItem(2, "2024-01-01 00:00:00"),
      makeItem(3, "2020-01-01 00:00:00"),
      makeItem(4, "2024-01-01 00:00:00"),
    ];
    setItems(items);
    installDuplicateSearch(
      {
        1: [1, 2],
        3: [3, 4],
      },
      [1, 3],
    );

    const controller = new BulkMergeController();
    const win = makeWindow();
    mergeMock.mockImplementationOnce(async (_masterItem: any, otherItems: any[]) => {
      otherItems.forEach((item) => {
        item.deleted = true;
      });
      (controller as any).setRunning(win, false);
    });

    let promptCount = 0;
    _Zotero.Prompt.confirm = jest.fn((options: any) => {
      promptCount += 1;
      if (promptCount === 1) return 0;
      options.checkbox.value = true;
      return 1;
    });

    await clickBulkMergeButton(controller, win);

    expect(mergeMock).toHaveBeenCalledTimes(1);
    expect(items[1].deleted).toBe(false);
    expect(items[1].saveTx).toHaveBeenCalledTimes(1);
    expect(mergeMock).not.toHaveBeenCalledWith(items[2], [items[3]]);
  });
});
