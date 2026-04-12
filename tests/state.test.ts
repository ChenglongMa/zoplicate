/**
 * Tests for src/utils/state.ts accessor functions.
 *
 * The global `addon` stub is set up in tests/__setup__/globals.ts.
 * Each test manipulates addon.data directly to verify accessors.
 */

import { jest, describe, test, expect, beforeEach } from "@jest/globals";

import {
  getEnv,
  isAlive,
  setAlive,
  getLocale,
  setLocale,
  getPrefs,
  setPrefs,
  getDialogs,
  getConfig,
  getMenuRegisteredIDs,
  setMenuRegisteredIDs,
  getNonDuplicateSectionID,
  setNonDuplicateSectionID,
  getDuplicateCounts,
  setDuplicateCounts,
  markDuplicateSearchDirty,
  isProcessing,
  setProcessing,
  closeDialogWindow,
  getDuplicateSearchObj,
  setDuplicateSearchObj,
  getDuplicateSets,
  setDuplicateSets,
  getNeedResetDuplicateSearch,
  setNeedResetDuplicateSearch,
} from "../src/utils/state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAddonData() {
  (globalThis as any).addon.data = {
    alive: true,
    config: {
      addonName: "Zoplicate",
      addonID: "zoplicate@chenglongma.com",
      addonRef: "zoplicate",
      addonInstance: "Zoplicate",
      prefsPrefix: "extensions.zotero.zoplicate",
    },
    env: "development",
    database: "SQLite",
    ztoolkit: (globalThis as any).ztoolkit,
    dialogs: {},
    needResetDuplicateSearch: {},
    duplicateSearchObj: {},
    duplicateCounts: {},
    duplicateSets: {},
    nonDuplicateSectionID: false,
    menuRegisteredIDs: [],
    processing: false,
  };
}

beforeEach(() => {
  resetAddonData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("state accessors", () => {
  // 1
  test("isAlive / setAlive round-trip", () => {
    expect(isAlive()).toBe(true);
    setAlive(false);
    expect(isAlive()).toBe(false);
    setAlive(true);
    expect(isAlive()).toBe(true);
  });

  // 2
  test("isAlive returns false when addon is undefined", () => {
    const saved = (globalThis as any).addon;
    (globalThis as any).addon = undefined;
    expect(isAlive()).toBe(false);
    (globalThis as any).addon = saved;
  });

  // 3
  test("getEnv returns current environment", () => {
    expect(getEnv()).toBe("development");
    (globalThis as any).addon.data.env = "production";
    expect(getEnv()).toBe("production");
  });

  // 4
  test("getLocale returns undefined before initLocale", () => {
    expect(getLocale()).toBeUndefined();
  });

  // 5
  test("setLocale / getLocale round-trip", () => {
    const loc = { current: { formatMessagesSync: () => [] } };
    setLocale(loc);
    expect(getLocale()).toBe(loc);
  });

  // 6
  test("getPrefs returns undefined before prefs window opens", () => {
    expect(getPrefs()).toBeUndefined();
  });

  // 7
  test("setPrefs / getPrefs round-trip", () => {
    const prefs = { window: {} as Window };
    setPrefs(prefs);
    expect(getPrefs()).toBe(prefs);
  });

  // 8
  test("getDialogs returns mutable reference", () => {
    const dialogs = getDialogs();
    expect(dialogs).toBeDefined();
    dialogs.duplicateMaps = new Map();
    expect(getDialogs().duplicateMaps).toBe(dialogs.duplicateMaps);
  });

  // 9
  test("getConfig returns static config", () => {
    const cfg = getConfig();
    expect(cfg.addonID).toBe("zoplicate@chenglongma.com");
    expect(cfg.addonRef).toBe("zoplicate");
  });

  // 10
  test("getMenuRegisteredIDs / setMenuRegisteredIDs round-trip", () => {
    expect(getMenuRegisteredIDs()).toEqual([]);
    setMenuRegisteredIDs(["menu-1", "menu-2"]);
    expect(getMenuRegisteredIDs()).toEqual(["menu-1", "menu-2"]);
  });

  // 11
  test("getNonDuplicateSectionID / setNonDuplicateSectionID round-trip", () => {
    expect(getNonDuplicateSectionID()).toBe(false);
    setNonDuplicateSectionID("section-1");
    expect(getNonDuplicateSectionID()).toBe("section-1");
    setNonDuplicateSectionID(false);
    expect(getNonDuplicateSectionID()).toBe(false);
  });

  // 12
  test("getDuplicateCounts / setDuplicateCounts round-trip", () => {
    expect(getDuplicateCounts()).toEqual({});
    setDuplicateCounts(1, { total: 10, unique: 3 });
    expect(getDuplicateCounts()[1]).toEqual({ total: 10, unique: 3 });
  });

  // 13
  test("markDuplicateSearchDirty sets flag for libraryID", () => {
    expect(getNeedResetDuplicateSearch()[5]).toBeUndefined();
    markDuplicateSearchDirty(5);
    expect(getNeedResetDuplicateSearch()[5]).toBe(true);
  });

  // 14
  test("isProcessing / setProcessing round-trip", () => {
    expect(isProcessing()).toBe(false);
    setProcessing(true);
    expect(isProcessing()).toBe(true);
    setProcessing(false);
    expect(isProcessing()).toBe(false);
  });

  // 15
  test("closeDialogWindow is no-op when dialog is undefined", () => {
    expect(() => closeDialogWindow()).not.toThrow();
  });

  // 16
  test("closeDialogWindow is no-op when dialog.window is undefined", () => {
    (globalThis as any).addon.data.dialogs = { dialog: {} };
    expect(() => closeDialogWindow()).not.toThrow();
  });

  // 17
  test("closeDialogWindow calls close() when window exists", () => {
    const closeFn = jest.fn();
    (globalThis as any).addon.data.dialogs = {
      dialog: { window: { close: closeFn } },
    };
    closeDialogWindow();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  // 18
  test("getDuplicateSearchObj / setDuplicateSearchObj round-trip", () => {
    const search = { id: "mock-search" } as any;
    setDuplicateSearchObj(1, search);
    expect(getDuplicateSearchObj()[1]).toBe(search);
  });

  // 19
  test("getDuplicateSets / setDuplicateSets round-trip", () => {
    const sets = { id: "mock-sets" } as any;
    setDuplicateSets(1, sets);
    expect(getDuplicateSets()[1]).toBe(sets);
  });

  // 20
  test("getNeedResetDuplicateSearch / setNeedResetDuplicateSearch round-trip", () => {
    setNeedResetDuplicateSearch(7, true);
    expect(getNeedResetDuplicateSearch()[7]).toBe(true);
    setNeedResetDuplicateSearch(7, false);
    expect(getNeedResetDuplicateSearch()[7]).toBe(false);
  });
});
