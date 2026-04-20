import { describe, expect, test, jest } from "@jest/globals";

const order: string[] = [];
const registrationOrder: string[] = [];

const makeDisposer = (label: string) => () => {
  order.push(label);
};

const registerPreferencesGlobalMock = jest.fn(async () => {
  registrationOrder.push("global:preferences");
  return makeDisposer("global:preferences");
});
jest.mock("../src/features/preferences", () => ({
  registerPreferencesGlobal: registerPreferencesGlobalMock,
  registerPrefsScripts: jest.fn(),
}));

const registerBulkMergeWindowMock = jest.fn(async (win: any) => {
  registrationOrder.push(`window:${win.name}:bulk`);
  return makeDisposer(`window:${win.name}:bulk`);
});
jest.mock("../src/features/bulkMerge", () => ({
  bulkMergeController: {
    isRunning: false,
    createBulkMergeButton: jest.fn((_win: Window, id: string) => ({ tag: "button", id })),
  },
  registerBulkMergeWindow: registerBulkMergeWindowMock,
}));

const registerDuplicatesGlobalMock = jest.fn<(...args: any[]) => Promise<() => void>>(async () => {
  registrationOrder.push("global:duplicates");
  return makeDisposer("global:duplicates");
});
const registerDuplicatesWindowMock = jest.fn(async (win: any) => {
  registrationOrder.push(`window:${win.name}:duplicates`);
  return makeDisposer(`window:${win.name}:duplicates`);
});
const createDuplicatesNotifyHandlerMock = jest.fn<(...args: any[]) => (...handlerArgs: any[]) => void>(() => jest.fn());
jest.mock("../src/features/duplicates", () => ({
  createDuplicatesNotifyHandler: createDuplicatesNotifyHandlerMock,
  registerDuplicatesGlobal: registerDuplicatesGlobalMock,
  registerDuplicatesWindow: registerDuplicatesWindowMock,
  updateDuplicateButtonsVisibilities: jest.fn(),
}));

const registerDuplicateStatsGlobalMock = jest.fn(async () => {
  registrationOrder.push("global:duplicateStats");
  return makeDisposer("global:duplicateStats");
});
const registerDuplicateStatsWindowMock = jest.fn(async (win: any) => {
  registrationOrder.push(`window:${win.name}:duplicateStats`);
  return makeDisposer(`window:${win.name}:duplicateStats`);
});
jest.mock("../src/features/duplicateStats", () => ({
  refreshDuplicateStats: jest.fn(),
  registerDuplicateStatsGlobal: registerDuplicateStatsGlobalMock,
  registerDuplicateStatsWindow: registerDuplicateStatsWindowMock,
}));

const registerNonDuplicatesGlobalMock = jest.fn(async (_db?: any) => {
  registrationOrder.push("global:nonDuplicates");
  return makeDisposer("global:nonDuplicates");
});
const registerNonDuplicatesWindowMock = jest.fn(async (win: any) => {
  registrationOrder.push(`window:${win.name}:nonDuplicates`);
  return makeDisposer(`window:${win.name}:nonDuplicates`);
});
const cleanupLegacyNonDuplicateSyncedSettingsMock = jest.fn(async () => {
  registrationOrder.push("global:legacyCleanup");
});
jest.mock("../src/features/nonDuplicates", () => ({
  cleanupLegacyNonDuplicateSyncedSettings: cleanupLegacyNonDuplicateSyncedSettingsMock,
  createNonDuplicateButton: jest.fn((_win: Window, id: string) => ({ tag: "button", id })),
  createNonDuplicatesNotifyHandler: jest.fn(() => jest.fn()),
  NonDuplicates: { getInstance: jest.fn(() => ({ allNonDuplicates: new Set() })) },
  registerNonDuplicatesGlobal: registerNonDuplicatesGlobalMock,
  registerNonDuplicatesWindow: registerNonDuplicatesWindowMock,
}));

const registerNotifierMock = jest.fn(() => {
  registrationOrder.push("global:notifier");
  return makeDisposer("global:notifier");
});
const notifyDispatcherMock = {
  registerHandler: jest.fn(() => {
    registrationOrder.push("global:handler");
    return makeDisposer("global:handler");
  }),
  dispatch: jest.fn(),
  setReady: jest.fn(async (_ready: boolean) => undefined),
  reset: jest.fn(() => order.push("dispatcher:reset")),
};
jest.mock("../src/integrations/zotero/notifier", () => ({
  notifyDispatcher: notifyDispatcherMock,
  registerNotifier: registerNotifierMock,
}));

jest.mock("../src/integrations/zotero/menuCache", () => ({
  createMenuCacheNotifyHandler: jest.fn(() => jest.fn()),
}));

const registerDevelopmentItemIDColumnMock = jest.fn(async (_env?: string, _enabled?: boolean) => {
  registrationOrder.push("global:devColumn");
  return makeDisposer("global:devColumn");
});
jest.mock("../src/integrations/zotero/devColumn", () => ({
  registerDevelopmentItemIDColumn: registerDevelopmentItemIDColumnMock,
}));

const registerStyleSheetsMock = jest.fn();
jest.mock("../src/integrations/zotero/windowChrome", () => ({
  registerStyleSheets: registerStyleSheetsMock,
}));

const initLocaleMock = jest.fn();
jest.mock("../src/shared/locale", () => ({
  initLocale: initLocaleMock,
}));

jest.mock("../src/shared/debug", () => ({
  debug: jest.fn(),
}));

const initDbMock = jest.fn(async () => undefined);
const closeDbMock = jest.fn(async () => order.push("db:close"));
const nonDuplicatesDBInstance = {
  init: initDbMock,
  close: closeDbMock,
};
jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: nonDuplicatesDBInstance,
  },
}));

function makeWindow(name: string): any {
  return {
    name,
    MozXULElement: {
      insertFTLIfNeeded: jest.fn(),
    },
  };
}

describe("app hooks lifecycle disposal", () => {
  test("onShutdown disposes all window resources before global resources and is double-dispose safe", async () => {
    jest.useFakeTimers();
    order.length = 0;
    registrationOrder.length = 0;
    jest.clearAllMocks();
    (globalThis as any).addon.data.env = "production";

    const win1 = makeWindow("one");
    const win2 = makeWindow("two");
    (globalThis as any).Zotero.initializationPromise = Promise.resolve();
    (globalThis as any).Zotero.unlockPromise = Promise.resolve();
    (globalThis as any).Zotero.uiReadyPromise = Promise.resolve();
    (globalThis as any).Zotero.getMainWindows = jest.fn(() => [win1, win2]);
    (globalThis as any).Zotero.Zoplicate = {};
    (globalThis as any).ztoolkit.unregisterAll = jest.fn(() => order.push("ztoolkit:unregisterAll"));

    const hooks = (await import("../src/app/hooks")).default;

    await hooks.onStartup();

    expect(initLocaleMock).toHaveBeenCalledTimes(1);

    expect(initDbMock).toHaveBeenCalledTimes(1);
    expect(registerNonDuplicatesGlobalMock).toHaveBeenCalledWith(nonDuplicatesDBInstance);
    expect(registerDuplicatesGlobalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getLoadedWindows: expect.any(Function),
      }),
    );
    expect(registerDuplicatesGlobalMock.mock.calls[0][0].getLoadedWindows()).toEqual([win1, win2]);
    expect(createDuplicatesNotifyHandlerMock).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    expect(registerDevelopmentItemIDColumnMock).toHaveBeenCalledWith("production", false);
    expect(cleanupLegacyNonDuplicateSyncedSettingsMock).toHaveBeenCalledTimes(1);
    expect(win1.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-itemSection.ftl");
    expect(win1.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-addon.ftl");
    expect(win2.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-itemSection.ftl");
    expect(win2.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-addon.ftl");
    expect(registerStyleSheetsMock).toHaveBeenCalledWith(win1);
    expect(registerStyleSheetsMock).toHaveBeenCalledWith(win2);

    const firstWindowRegistration = registrationOrder.findIndex((entry) => entry.startsWith("window:"));
    const lastGlobalRegistration = Math.max(
      ...registrationOrder.map((entry, index) => (entry.startsWith("global:") ? index : -1)),
    );
    expect(firstWindowRegistration).toBeGreaterThan(lastGlobalRegistration);

    await hooks.onShutdown();
    await hooks.onShutdown();

    const firstGlobalIndex = order.findIndex((entry) => entry.startsWith("global:"));
    const lastWindowIndex = Math.max(
      ...order.map((entry, index) => (entry.startsWith("window:") ? index : -1)),
    );

    expect(lastWindowIndex).toBeGreaterThanOrEqual(0);
    expect(firstGlobalIndex).toBeGreaterThan(lastWindowIndex);
    expect(order.filter((entry) => entry.startsWith("window:")).length).toBe(8);
    expect(order.filter((entry) => entry === "ztoolkit:unregisterAll")).toHaveLength(1);
    expect(notifyDispatcherMock.reset).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(notifyDispatcherMock.setReady).not.toHaveBeenCalledWith(true);

    jest.useRealTimers();
  });

  test("reloading an already-loaded window does not duplicate window registrations", async () => {
    jest.clearAllMocks();
    registrationOrder.length = 0;
    order.length = 0;

    const win1 = makeWindow("one");
    (globalThis as any).Zotero.initializationPromise = Promise.resolve();
    (globalThis as any).Zotero.unlockPromise = Promise.resolve();
    (globalThis as any).Zotero.uiReadyPromise = Promise.resolve();
    (globalThis as any).Zotero.getMainWindows = jest.fn(() => [win1]);
    (globalThis as any).Zotero.Zoplicate = {};
    (globalThis as any).ztoolkit.unregisterAll = jest.fn();

    const hooks = (await import("../src/app/hooks")).default;

    await hooks.onStartup();
    const firstRunWindowEntries = registrationOrder.filter((entry) => entry.startsWith("window:one:")).length;

    await hooks.onMainWindowLoad(win1 as any);
    const secondRunWindowEntries = registrationOrder.filter((entry) => entry.startsWith("window:one:")).length;

    expect(firstRunWindowEntries).toBe(4);
    expect(secondRunWindowEntries).toBe(8);
    expect(win1.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-itemSection.ftl");
    expect(win1.MozXULElement.insertFTLIfNeeded).toHaveBeenCalledWith("zoplicate-addon.ftl");

    await hooks.onShutdown();
  });

  test("onShutdown still runs final cleanup when database close fails", async () => {
    jest.clearAllMocks();
    registrationOrder.length = 0;
    order.length = 0;
    (globalThis as any).addon.data.alive = true;

    const win1 = makeWindow("one");
    (globalThis as any).Zotero.initializationPromise = Promise.resolve();
    (globalThis as any).Zotero.unlockPromise = Promise.resolve();
    (globalThis as any).Zotero.uiReadyPromise = Promise.resolve();
    (globalThis as any).Zotero.getMainWindows = jest.fn(() => [win1]);
    (globalThis as any).Zotero.Zoplicate = {};
    (globalThis as any).ztoolkit.unregisterAll = jest.fn(() => order.push("ztoolkit:unregisterAll"));
    closeDbMock.mockImplementationOnce(async () => {
      order.push("db:close");
      throw new Error("close failed");
    });

    const hooks = (await import("../src/app/hooks")).default;

    await hooks.onStartup();
    await expect(hooks.onShutdown()).resolves.toBeUndefined();

    expect((globalThis as any).addon.data.alive).toBe(false);
    expect((globalThis as any).ztoolkit.unregisterAll).toHaveBeenCalledTimes(1);
    expect((globalThis as any).Zotero.Zoplicate).toBeUndefined();
    expect((globalThis as any).ztoolkit.log).toHaveBeenCalledWith(
      "addon onShutdown: close non-duplicates database failed",
      expect.any(Error),
    );
  });
});
