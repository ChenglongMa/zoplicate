import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

import { Duplicates } from "../src/features/duplicates/duplicates";
import { Action, MasterItem } from "../src/shared/prefs";

const _Zotero = (globalThis as any).Zotero;
const _ztoolkit = (globalThis as any).ztoolkit;
const _addon = (globalThis as any).addon;

interface RelatedMockItemOverrides {
  id: number;
  key: string;
  itemType?: string;
  dateAdded?: string;
  deleted?: boolean;
  relatedItems?: string[];
}

function createRelatedMockItem(overrides: RelatedMockItemOverrides): any {
  return {
    id: overrides.id,
    key: overrides.key,
    itemType: overrides.itemType ?? "book",
    libraryID: 1,
    dateAdded: overrides.dateAdded ?? "2024-01-01 00:00:00",
    dateModified: overrides.dateAdded ?? "2024-01-01 00:00:00",
    deleted: overrides.deleted ?? false,
    relatedItems: overrides.relatedItems ?? [],
    isRegularItem: jest.fn(() => true),
    getDisplayTitle: jest.fn(() => `Item ${overrides.id}`),
    numAttachments: jest.fn(() => 1),
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
  _Zotero.Items.getAsync = jest.fn(async (id: number) => itemMap.get(id));
}

function makeProgressWindow() {
  const progressWindow: any = {
    createLine: jest.fn(() => progressWindow),
    changeLine: jest.fn(),
    show: jest.fn(() => progressWindow),
  };
  return progressWindow;
}

function makeWindow(selectItems = jest.fn()) {
  return {
    closed: false,
    ZoteroPane: { selectItems },
  } as any;
}

// duplicatesObj returns the duplicate set partner(s) for a given item id
function makeDuplicatesObj(setByID: Record<number, number[]>) {
  return {
    getSetItemsByItemID: jest.fn((itemID: number) => setByID[itemID] ?? []),
  };
}

// whenItemsAdded fires processDuplicates without awaiting ("DONT WAIT"),
// so let its microtask chain drain before asserting on merge.
async function flushAsync() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  _addon.data.dialogs = {};
  _addon.data.processing = false;
  // Auto-process path (not "Always Ask"): KEEP newest.
  mockGetPref.mockImplementation((key: string) => (key === "bulk.master.item" ? MasterItem.OLDEST : Action.KEEP));
  _ztoolkit.ProgressWindow = jest.fn(() => makeProgressWindow());
  _Zotero.getActiveZoteroPane = jest.fn(() => ({ selectItems: jest.fn() }));
});

describe("Regression #169: transient Create-Book-Section item must not be auto-merged", () => {
  test("does not auto-merge a freshly added item explicitly related to its detected duplicate", async () => {
    // Original book (id 1) and the transient duplicate (id 2) created by
    // "Create Book Section" are explicitly related to each other.
    const original = createRelatedMockItem({ id: 1, key: "ORIG", dateAdded: "2020-01-01 00:00:00", relatedItems: ["DUP"] });
    const transient = createRelatedMockItem({ id: 2, key: "DUP", dateAdded: "2024-01-01 00:00:00", relatedItems: ["ORIG"] });
    setItems([original, transient]);

    const win = makeWindow();
    const duplicatesObj = makeDuplicatesObj({ 1: [1, 2], 2: [1, 2] });

    await Duplicates.instance.whenItemsAdded(duplicatesObj, [2], { win });
    await flushAsync();

    expect(mockMerge).not.toHaveBeenCalled();
  });

  test("still auto-merges a freshly added item that is a genuine, unrelated duplicate", async () => {
    const original = createRelatedMockItem({ id: 1, key: "ORIG", dateAdded: "2020-01-01 00:00:00", relatedItems: [] });
    const newDup = createRelatedMockItem({ id: 2, key: "NEWDUP", dateAdded: "2024-01-01 00:00:00", relatedItems: [] });
    setItems([original, newDup]);

    const win = makeWindow();
    const duplicatesObj = makeDuplicatesObj({ 1: [1, 2], 2: [1, 2] });

    await Duplicates.instance.whenItemsAdded(duplicatesObj, [2], { win });
    await flushAsync();

    expect(mockMerge).toHaveBeenCalledTimes(1);
  });

  test("relation detected from only one direction still blocks auto-merge", async () => {
    // Only the original records the relation; the new item's copy may not be loaded yet.
    const original = createRelatedMockItem({ id: 1, key: "ORIG", dateAdded: "2020-01-01 00:00:00", relatedItems: ["DUP"] });
    const transient = createRelatedMockItem({ id: 2, key: "DUP", dateAdded: "2024-01-01 00:00:00", relatedItems: [] });
    setItems([original, transient]);

    const win = makeWindow();
    const duplicatesObj = makeDuplicatesObj({ 1: [1, 2], 2: [1, 2] });

    await Duplicates.instance.whenItemsAdded(duplicatesObj, [2], { win });
    await flushAsync();

    expect(mockMerge).not.toHaveBeenCalled();
  });
});
