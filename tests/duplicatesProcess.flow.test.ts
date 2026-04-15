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

import { type DuplicateGroupMap } from "../src/app/state";
import { Duplicates } from "../src/features/duplicates/duplicates";
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
  _ztoolkit.ProgressWindow = jest.fn(() => makeProgressWindow());
  _Zotero.getActiveZoteroPane = jest.fn(() => ({ selectItems: jest.fn() }));
});

describe("Duplicates.processDuplicates merge decisions", () => {
  test("keep new uses the newest newly imported item as master", async () => {
    const oldItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00", displayTitle: "Old" });
    const firstNewItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00", displayTitle: "New 1" });
    const newestNewItem = createMockItem({ id: 3, dateAdded: "2024-01-02 00:00:00", displayTitle: "New 2" });
    const selectItems = jest.fn();
    const win = makeWindow(selectItems);
    setItems([oldItem, firstNewItem, newestNewItem]);

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2, 3],
          newItemIDs: [2, 3],
          action: Action.KEEP,
        },
      ],
    ]);

    await Duplicates.instance.processDuplicates(duplicateMaps, { win });

    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(mockMerge).toHaveBeenCalledWith(newestNewItem, [oldItem, firstNewItem]);
    expect(selectItems).toHaveBeenCalledWith([3]);
  });

  test("does not use the active pane when no source window is available", async () => {
    const oldItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00", displayTitle: "Old" });
    const newItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00", displayTitle: "New" });
    const selectItems = jest.fn();
    setItems([oldItem, newItem]);
    _Zotero.getActiveZoteroPane = jest.fn(() => ({ selectItems }));

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2],
          newItemIDs: [2],
          action: Action.DISCARD,
        },
      ],
    ]);

    await Duplicates.instance.processDuplicates(duplicateMaps);

    expect(mockMerge).toHaveBeenCalledTimes(1);
    expect(selectItems).not.toHaveBeenCalled();
  });

  test("skips groups that have fewer than two active unique items", async () => {
    const activeItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00" });
    const deletedItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00", deleted: true });
    setItems([activeItem, deletedItem]);

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

    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockWaitUntilAsync).not.toHaveBeenCalled();
    expect(_addon.data.processing).toBe(false);
  });

  test("resets processing state when merge fails", async () => {
    const oldItem = createMockItem({ id: 1, dateAdded: "2020-01-01 00:00:00" });
    const newItem = createMockItem({ id: 2, dateAdded: "2024-01-01 00:00:00" });
    setItems([oldItem, newItem]);
    mockMerge.mockRejectedValueOnce(new Error("merge failed"));

    const duplicateMaps: DuplicateGroupMap = new Map([
      [
        1,
        {
          itemIDs: [1, 2],
          newItemIDs: [2],
          action: Action.DISCARD,
        },
      ],
    ]);

    await expect(Duplicates.instance.processDuplicates(duplicateMaps)).rejects.toThrow("merge failed");

    expect(_addon.data.processing).toBe(false);
  });
});

describe("duplicate dialog batch map updates", () => {
  test("preserves a chosen row action when a later import expands the same group", () => {
    const duplicates = Duplicates.instance as any;
    const firstMap: DuplicateGroupMap = new Map([
      [1, { itemIDs: [1, 2], newItemIDs: [2], action: Action.ASK }],
    ]);
    const secondMap: DuplicateGroupMap = new Map([
      [1, { itemIDs: [1, 2, 3], newItemIDs: [3], action: Action.ASK }],
    ]);

    duplicates.updateDuplicateMaps(firstMap);
    _addon.data.dialogs.duplicateMaps.get(1).action = Action.KEEP;
    duplicates.updateDuplicateMaps(secondMap);

    expect(_addon.data.dialogs.duplicateMaps.get(1)).toEqual({
      itemIDs: [1, 2, 3],
      newItemIDs: [2, 3],
      action: Action.KEEP,
    });
  });

  test("adds disjoint later imports as separate dialog rows", () => {
    const duplicates = Duplicates.instance as any;
    const firstMap: DuplicateGroupMap = new Map([
      [1, { itemIDs: [1, 2], newItemIDs: [2], action: Action.ASK }],
    ]);
    const secondMap: DuplicateGroupMap = new Map([
      [10, { itemIDs: [10, 11], newItemIDs: [11], action: Action.ASK }],
    ]);

    duplicates.updateDuplicateMaps(firstMap);
    duplicates.updateDuplicateMaps(secondMap);

    expect([..._addon.data.dialogs.duplicateMaps.keys()]).toEqual([1, 10]);
    expect(_addon.data.dialogs.duplicateMaps.get(1).action).toBe(Action.CANCEL);
    expect(_addon.data.dialogs.duplicateMaps.get(10).action).toBe(Action.CANCEL);
  });
});
