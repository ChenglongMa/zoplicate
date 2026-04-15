import { describe, expect, test, beforeEach, jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const invalidateAllMock = jest.fn();
const menuCacheBuildKeyMock = jest.fn((ids: number[]) => [...ids].sort((a, b) => a - b).join("-"));
const menuCacheGetMock = jest.fn<(key: string) => any>();
const menuCacheSetMock = jest.fn();
const warmCacheMock = jest.fn<(...args: any[]) => Promise<void>>(async (itemIDs: number[], libraryID?: number) => {
  if (itemIDs.length < 2) return;
  const key = menuCacheBuildKeyMock(itemIDs);
  const isNonDuplicate = await existsNonDuplicatesMock(itemIDs);
  const { duplicatesObj } = await fetchDuplicatesMock({ libraryID, refresh: false });
  const duplicateSet = new Set(duplicatesObj.getSetItemsByItemID(itemIDs[0]));
  const isDuplicateSet = itemIDs.every((id: number) => duplicateSet.has(id));
  menuCacheSetMock(key, { isNonDuplicate, isDuplicateSet });
});
jest.mock("../src/integrations/zotero/menuCache", () => ({
  menuCache: {
    invalidateAll: invalidateAllMock,
    buildKey: menuCacheBuildKeyMock,
    get: menuCacheGetMock,
    set: menuCacheSetMock,
    invalidate: jest.fn(),
  },
  warmCache: warmCacheMock,
}));

const toggleNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
jest.mock("../src/features/nonDuplicates/nonDuplicateActions", () => ({
  toggleNonDuplicates: toggleNonDuplicatesMock,
}));

const existsNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<boolean>>(async () => false);
jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: {
      existsNonDuplicates: existsNonDuplicatesMock,
    },
  },
}));

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({
  libraryID: 1,
  duplicatesObj: { getSetItemsByItemID: jest.fn(() => [10, 20]) },
  duplicateItems: [10, 20],
}));
const fetchAllDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>(async () => undefined);
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
  fetchAllDuplicates: fetchAllDuplicatesMock,
}));

const showingDuplicateStatsMock = jest.fn(() => true);
jest.mock("../src/shared/prefs", () => ({
  showingDuplicateStats: showingDuplicateStatsMock,
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
}));

// ---------------------------------------------------------------------------
// Zotero global mocks
// ---------------------------------------------------------------------------

const _Zotero = (globalThis as any).Zotero;

const registerMenuMock = jest.fn<(...args: any[]) => string | false>(() => "mock-menu-id");
const unregisterMenuMock = jest.fn<(...args: any[]) => boolean>(() => true);

_Zotero.MenuManager = {
  registerMenu: registerMenuMock,
  unregisterMenu: unregisterMenuMock,
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { itemMenuConfig } from "../src/features/nonDuplicates/nonDuplicateMenu";
import { collectionMenuConfig } from "../src/features/duplicateStats/duplicateStatsMenu";
import { registerMenus, unregisterMenus } from "../src/integrations/zotero/menuManager";
import { warmCache } from "../src/integrations/zotero/menuCache";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerMenus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerMenuMock.mockReturnValue("mock-menu-id");
  });

  test("calls Zotero.MenuManager.registerMenu twice (item + collection)", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    expect(registerMenuMock).toHaveBeenCalledTimes(2);
  });

  test("returns array of menu IDs from registerMenu calls", () => {
    registerMenuMock.mockReturnValueOnce("item-menu-id").mockReturnValueOnce("collection-menu-id");
    const ids = registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    expect(ids).toEqual(["item-menu-id", "collection-menu-id"]);
  });

  test("filters out false returns from registerMenu", () => {
    registerMenuMock.mockReturnValueOnce("item-menu-id").mockReturnValueOnce(false);
    const ids = registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    expect(ids).toEqual(["item-menu-id"]);
  });

  test("item menu uses target main/library/item", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const firstCall = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    expect(firstCall.target).toBe("main/library/item");
  });

  test("collection menu uses target main/library/collection", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const secondCall = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    expect(secondCall.target).toBe("main/library/collection");
  });

  test("item menu has submenu with two children (mark and unmark)", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    // Top-level menus array contains one submenu
    expect(itemOptions.menus.length).toBe(1);
    const submenu = itemOptions.menus[0];
    expect(submenu.menuType).toBe("submenu");
    expect(submenu.menus).toBeDefined();
    expect(submenu.menus!.length).toBe(2);
  });

  test("item menu submenu has correct l10nIDs", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    expect(submenu.l10nID).toBe("zoplicate-addon-name");
    const children = submenu.menus!;
    expect(children[0].l10nID).toBe("zoplicate-menu-unmark-non-duplicate");
    expect(children[1].l10nID).toBe("zoplicate-menu-mark-non-duplicate");
  });

  test("collection menu has a single menuitem", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const collectionOptions = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    expect(collectionOptions.menus.length).toBe(1);
    expect(collectionOptions.menus[0].menuType).toBe("menuitem");
  });
});

describe("unregisterMenus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("calls Zotero.MenuManager.unregisterMenu for each ID", () => {
    unregisterMenus(["id-1", "id-2", "id-3"]);
    expect(unregisterMenuMock).toHaveBeenCalledTimes(3);
    expect(unregisterMenuMock).toHaveBeenCalledWith("id-1");
    expect(unregisterMenuMock).toHaveBeenCalledWith("id-2");
    expect(unregisterMenuMock).toHaveBeenCalledWith("id-3");
  });

  test("handles empty array gracefully", () => {
    unregisterMenus([]);
    expect(unregisterMenuMock).not.toHaveBeenCalled();
  });
});

describe("item menu onShowing callback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerMenuMock.mockReturnValue("mock-menu-id");
  });

  test("onShowing with cache hit (isNonDuplicate) shows unmark, hides mark", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    const onShowing = submenu.onShowing!;

    const mockItems = [
      { id: 10, libraryID: 1 },
      { id: 20, libraryID: 1 },
    ];
    const setVisibleSubmenu = jest.fn();
    const setEnabledSubmenu = jest.fn();

    menuCacheGetMock.mockReturnValue({ isNonDuplicate: true, isDuplicateSet: true });

    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleSubmenu,
      setEnabled: setEnabledSubmenu,
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      items: mockItems,
    };

    onShowing({} as Event, ctx);

    // submenu should be visible
    expect(setVisibleSubmenu).toHaveBeenCalledWith(true);
    expect(setEnabledSubmenu).toHaveBeenCalledWith(true);
  });

  test("onShowing with cache miss disables submenu", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    const onShowing = submenu.onShowing!;

    const mockItems = [
      { id: 10, libraryID: 1 },
      { id: 20, libraryID: 1 },
    ];
    const setVisibleSubmenu = jest.fn();
    const setEnabledSubmenu = jest.fn();

    menuCacheGetMock.mockReturnValue(undefined); // cache miss

    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleSubmenu,
      setEnabled: setEnabledSubmenu,
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      items: mockItems,
    };

    onShowing({} as Event, ctx);

    // submenu visible but disabled on cache miss
    expect(setVisibleSubmenu).toHaveBeenCalledWith(true);
    expect(setEnabledSubmenu).toHaveBeenCalledWith(false);
    expect(warmCacheMock).toHaveBeenCalledWith([10, 20], 1);
  });

  test("onShowing hides submenu when fewer than 2 items selected", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    const onShowing = submenu.onShowing!;

    const setVisibleSubmenu = jest.fn();
    const setEnabledSubmenu = jest.fn();

    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleSubmenu,
      setEnabled: setEnabledSubmenu,
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      items: [{ id: 10, libraryID: 1 }], // only one item
    };

    onShowing({} as Event, ctx);

    expect(setVisibleSubmenu).toHaveBeenCalledWith(false);
  });
});

describe("collection menu onShowing callback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerMenuMock.mockReturnValue("mock-menu-id");
  });

  test("onShowing shows when in duplicates pane and stats enabled", () => {
    showingDuplicateStatsMock.mockReturnValue(true);
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const collectionOptions = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    const menuItem = collectionOptions.menus[0];
    const onShowing = menuItem.onShowing!;

    const setVisibleMenu = jest.fn();
    const collectionTreeRow = { isDuplicates: () => true };
    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleMenu,
      setEnabled: jest.fn(),
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      collectionTreeRow,
    };

    onShowing({} as Event, ctx);
    expect(setVisibleMenu).toHaveBeenCalledWith(true);
  });

  test("onShowing hides when not in duplicates pane", () => {
    showingDuplicateStatsMock.mockReturnValue(true);
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const collectionOptions = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    const menuItem = collectionOptions.menus[0];
    const onShowing = menuItem.onShowing!;

    const setVisibleMenu = jest.fn();
    const collectionTreeRow = { isDuplicates: () => false };
    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleMenu,
      setEnabled: jest.fn(),
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      collectionTreeRow,
    };

    onShowing({} as Event, ctx);
    expect(setVisibleMenu).toHaveBeenCalledWith(false);
  });

  test("onShowing hides when stats disabled", () => {
    showingDuplicateStatsMock.mockReturnValue(false);
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const collectionOptions = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    const menuItem = collectionOptions.menus[0];
    const onShowing = menuItem.onShowing!;

    const setVisibleMenu = jest.fn();
    const collectionTreeRow = { isDuplicates: () => true };
    const ctx: any = {
      menuElem: {},
      setVisible: setVisibleMenu,
      setEnabled: jest.fn(),
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
      collectionTreeRow,
    };

    onShowing({} as Event, ctx);
    expect(setVisibleMenu).toHaveBeenCalledWith(false);
  });

  test("onCommand refreshes duplicates then invalidates menu cache", async () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const collectionOptions = registerMenuMock.mock.calls[1][0] as Zotero.MenuOptions;
    const menuItem = collectionOptions.menus[0];
    const onCommand = menuItem.onCommand!;
    const progressWindow = {
      createLine: jest.fn(() => progressWindow),
      show: jest.fn(),
    };
    (globalThis as any).ztoolkit.ProgressWindow = jest.fn(() => progressWindow);

    onCommand({} as Event, {} as Zotero.MenuContext);
    await Promise.resolve();

    expect(fetchAllDuplicatesMock).toHaveBeenCalledWith(true);
    expect(invalidateAllMock).toHaveBeenCalled();
    expect(progressWindow.show).toHaveBeenCalled();
  });
});

describe("warmCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("populates cache for given item IDs", async () => {
    existsNonDuplicatesMock.mockResolvedValue(true);
    fetchDuplicatesMock.mockResolvedValue({
      libraryID: 1,
      duplicatesObj: {
        getSetItemsByItemID: jest.fn(() => [10, 20]),
      },
      duplicateItems: [10, 20],
    });

    await warmCache([10, 20], 42);

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 42, refresh: false });
    expect(menuCacheSetMock).toHaveBeenCalledWith("10-20", {
      isNonDuplicate: true,
      isDuplicateSet: true,
    });
  });

  test("sets isDuplicateSet to false when items not in same set", async () => {
    existsNonDuplicatesMock.mockResolvedValue(false);
    fetchDuplicatesMock.mockResolvedValue({
      libraryID: 1,
      duplicatesObj: {
        getSetItemsByItemID: jest.fn(() => [10]), // only item 10, not 20
      },
      duplicateItems: [10],
    });

    await warmCache([10, 20]);

    expect(menuCacheSetMock).toHaveBeenCalledWith("10-20", {
      isNonDuplicate: false,
      isDuplicateSet: false,
    });
  });

  test("skips cache warming for single item", async () => {
    await warmCache([10]);

    expect(menuCacheSetMock).not.toHaveBeenCalled();
    expect(existsNonDuplicatesMock).not.toHaveBeenCalled();
  });
});

describe("item menu onCommand callbacks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerMenuMock.mockReturnValue("mock-menu-id");
  });

  test("unmark child calls toggleNonDuplicates with 'unmark' and libraryID", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    const unmarkChild = submenu.menus![0];
    const onCommand = unmarkChild.onCommand!;

    const mockItems = [
      { id: 10, libraryID: 42 },
      { id: 20, libraryID: 42 },
    ];
    const ctx: any = {
      menuElem: {},
      items: mockItems,
      setVisible: jest.fn(),
      setEnabled: jest.fn(),
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
    };

    onCommand({} as Event, ctx);

    expect(toggleNonDuplicatesMock).toHaveBeenCalledWith("unmark", mockItems, 42, { win: undefined });
  });

  test("mark child calls toggleNonDuplicates with 'mark' and libraryID", () => {
    registerMenus([itemMenuConfig(), collectionMenuConfig()]);
    const itemOptions = registerMenuMock.mock.calls[0][0] as Zotero.MenuOptions;
    const submenu = itemOptions.menus[0];
    const markChild = submenu.menus![1];
    const onCommand = markChild.onCommand!;

    const mockItems = [
      { id: 10, libraryID: 7 },
      { id: 20, libraryID: 7 },
    ];
    const ctx: any = {
      menuElem: {},
      items: mockItems,
      setVisible: jest.fn(),
      setEnabled: jest.fn(),
      setL10nArgs: jest.fn(),
      setIcon: jest.fn(),
    };

    onCommand({} as Event, ctx);

    expect(toggleNonDuplicatesMock).toHaveBeenCalledWith("mark", mockItems, 7, { win: undefined });
  });
});
