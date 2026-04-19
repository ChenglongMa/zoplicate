import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMockItem } from "./__setup__/globals";

const mockGetPref = jest.fn<(...args: any[]) => any>();
const mockSetPref = jest.fn<(...args: any[]) => any>();
const mockMerge = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const mockWaitUntilAsync = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
}));

jest.mock("../src/shared/prefs", () => {
  const actual = jest.requireActual("../src/shared/prefs") as typeof import("../src/shared/prefs");
  return {
    ...actual,
    getPref: mockGetPref,
    setPref: mockSetPref,
  };
});

jest.mock("../src/shared/duplicates/mergeItems", () => ({
  merge: mockMerge,
}));

jest.mock("../src/shared/wait", () => ({
  waitUntilAsync: mockWaitUntilAsync,
}));

jest.mock("../src/integrations/zotero/windows", () => ({
  goToDuplicatesPane: jest.fn(),
  getFirstLiveWindow: jest.fn((windows: Array<Window | undefined>) => windows.find((win) => win && !win.closed)),
  getZoteroPane: jest.fn((win: any) => win.ZoteroPane),
  isWindowAlive: jest.fn((win?: Window) => Boolean(win && !win.closed)),
}));

jest.mock("../src/integrations/zotero/windowChrome", () => ({
  bringToFront: jest.fn(),
}));

jest.mock("../src/shared/utils", () => ({
  showHintWithLink: jest.fn(async () => undefined),
}));

import { getDialogs, type DuplicateGroupMap } from "../src/app/state";
import { buildDuplicateGroupMap, Duplicates } from "../src/features/duplicates/duplicates";
import { Action, MasterItem } from "../src/shared/prefs";

const _Zotero = (globalThis as any).Zotero;
const _ztoolkit = (globalThis as any).ztoolkit;
const _addon = (globalThis as any).addon;

function makeProgressWindow() {
  const progressWindow = {
    createLine: jest.fn(() => progressWindow),
    changeLine: jest.fn(),
    show: jest.fn(() => progressWindow),
  };
  return progressWindow;
}

function makeWindow(selectItems = jest.fn()) {
  return {
    closed: false,
    ZoteroPane: {
      selectItems,
    },
  } as any;
}

function setItems(items: any[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  _Zotero.Items.get = jest.fn((input: number | number[]) => {
    if (Array.isArray(input)) {
      return input.map((id) => itemMap.get(id));
    }
    return itemMap.get(input);
  });
  _Zotero.Items.getAsync = jest.fn(async (id: number) => itemMap.get(id));
}

beforeEach(() => {
  jest.clearAllMocks();
  _addon.data.dialogs = {};
  _addon.data.processing = false;
  mockGetPref.mockImplementation((key: string) => (key === "bulk.master.item" ? MasterItem.OLDEST : Action.ASK));
  const progressWindow = makeProgressWindow();
  _ztoolkit.ProgressWindow = jest.fn(() => progressWindow);
  _Zotero.getActiveZoteroPane = jest.fn(() => ({ selectItems: jest.fn() }));
});

describe("duplicate dialog group construction", () => {
  test("merges additional imports into the existing duplicate group", () => {
    const firstDuplicatesObj = {
      getSetItemsByItemID: jest.fn((itemID: number) => (itemID === 2 ? [1, 2] : [])),
    };
    const secondDuplicatesObj = {
      getSetItemsByItemID: jest.fn((itemID: number) => (itemID === 3 ? [1, 2, 3] : [])),
    };

    const duplicates = Duplicates.instance as any;
    duplicates.updateDuplicateMaps(buildDuplicateGroupMap(firstDuplicatesObj, [2], Action.ASK));
    const firstEntry = getDialogs().duplicateMaps?.get(1);
    expect(getDialogs().duplicateMaps?.size).toBe(1);
    expect(firstEntry).toMatchObject({
      itemIDs: [1, 2],
      newItemIDs: [2],
      action: Action.CANCEL,
    });

    firstEntry!.action = Action.DISCARD;
    duplicates.updateDuplicateMaps(buildDuplicateGroupMap(secondDuplicatesObj, [3], Action.ASK));

    expect(getDialogs().duplicateMaps?.size).toBe(1);
    expect(getDialogs().duplicateMaps?.get(1)).toMatchObject({
      itemIDs: [1, 2, 3],
      newItemIDs: [2, 3],
      action: Action.DISCARD,
    });
  });
});

describe("Duplicates.showDuplicates", () => {
  test("opens duplicate dialog with fixed dimensions and toolkit auto-fit disabled", async () => {
    const openMock = jest.fn();
    const dialogMock = {
      dialogData: {},
      setDialogData: jest.fn(function (this: any, dialogData: any) {
        this.dialogData = dialogData;
        return this;
      }),
      addCell: jest.fn(function (this: any) {
        return this;
      }),
      addButton: jest.fn(function (this: any) {
        return this;
      }),
      open: openMock,
    };
    _ztoolkit.Dialog = jest.fn(() => dialogMock);

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2],
          newItemIDs: [2],
          action: Action.CANCEL,
        },
      ],
    ]);

    await Duplicates.instance.showDuplicates(duplicateMaps, { win: makeWindow() });

    expect(_ztoolkit.Dialog).toHaveBeenCalledWith(1, 1);
    expect(openMock).toHaveBeenCalledWith(
      "du-dialog-title",
      expect.objectContaining({
        width: 900,
        height: 620,
        fitContent: false,
        resizable: true,
      }),
    );
  });
});

describe("Duplicates.processDuplicates", () => {
  test("keep old merges a duplicate group once and preserves the old item as master", async () => {
    const oldItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00", displayTitle: "Old" });
    const newItem1 = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00", displayTitle: "New 1" });
    const newItem2 = createMockItem({ id: 3, dateAdded: "2024-01-02 00:00:00", displayTitle: "New 2" });
    setItems([oldItem, newItem1, newItem2]);

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2, 3],
          newItemIDs: [2, 3],
          action: Action.DISCARD,
        },
      ],
    ]);

    await Duplicates.instance.processDuplicates(duplicateMaps);

    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockMerge).toHaveBeenCalledWith(oldItem, [newItem1, newItem2]);
    expect(mockWaitUntilAsync).toHaveBeenCalledTimes(2);
    expect(_addon.data.processing).toBe(false);
  });

  test("keep old falls back to the oldest active item when every item is new", async () => {
    const firstNewItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00" });
    const secondNewItem = createMockItem({ id: 3, dateAdded: "2024-01-02 00:00:00" });
    setItems([firstNewItem, secondNewItem]);

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        2,
        {
          itemIDs: [2, 3],
          newItemIDs: [2, 3],
          action: Action.DISCARD,
        },
      ],
    ]);

    await Duplicates.instance.processDuplicates(duplicateMaps);

    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockMerge).toHaveBeenCalledWith(firstNewItem, [secondNewItem]);
  });

  test("skips later overlapping groups after one group has been processed", async () => {
    const oldItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00" });
    const sharedNewItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00" });
    const laterNewItem = createMockItem({ id: 3, dateAdded: "2024-01-02 00:00:00" });
    setItems([oldItem, sharedNewItem, laterNewItem]);

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2],
          newItemIDs: [2],
          action: Action.DISCARD,
        },
      ],
      [
        2,
        {
          itemIDs: [2, 3],
          newItemIDs: [3],
          action: Action.DISCARD,
        },
      ],
    ]);

    await Duplicates.instance.processDuplicates(duplicateMaps);

    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockMerge).toHaveBeenCalledWith(oldItem, [sharedNewItem]);
    expect(mockWaitUntilAsync).toHaveBeenCalledTimes(1);
  });
});
