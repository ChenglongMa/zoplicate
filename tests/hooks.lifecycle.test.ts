import { describe, expect, test, jest } from "@jest/globals";

const order: string[] = [];

const makeDisposer = (label: string) => () => {
  order.push(label);
};

const registerPreferencesGlobalMock = jest.fn(async () => makeDisposer("global:preferences"));
jest.mock("../src/features/preferences", () => ({
  registerPreferencesGlobal: registerPreferencesGlobalMock,
  registerPrefsScripts: jest.fn(),
}));

const registerBulkMergeWindowMock = jest.fn((win: any) => makeDisposer(`window:${win.name}:bulk`));
jest.mock("../src/features/bulkMerge", () => ({
  bulkMergeController: {
    isRunning: false,
    createBulkMergeButton: jest.fn((_win: Window, id: string) => ({ tag: "button", id })),
  },
  registerBulkMergeWindow: registerBulkMergeWindowMock,
}));

const registerDuplicatesGlobalMock = jest.fn(async () => makeDisposer("global:duplicates"));
const registerDuplicatesWindowMock = jest.fn(async (win: any) => makeDisposer(`window:${win.name}:duplicates`));
jest.mock("../src/features/duplicates", () => ({
  createDuplicatesNotifyHandler: jest.fn(() => jest.fn()),
  registerDuplicatesGlobal: registerDuplicatesGlobalMock,
  registerDuplicatesWindow: registerDuplicatesWindowMock,
  updateDuplicateButtonsVisibilities: jest.fn(),
}));

const registerDuplicateStatsGlobalMock = jest.fn(async () => makeDisposer("global:duplicateStats"));
const registerDuplicateStatsWindowMock = jest.fn(async (win: any) => makeDisposer(`window:${win.name}:duplicateStats`));
jest.mock("../src/features/duplicateStats", () => ({
  refreshDuplicateStats: jest.fn(),
  registerDuplicateStatsGlobal: registerDuplicateStatsGlobalMock,
  registerDuplicateStatsWindow: registerDuplicateStatsWindowMock,
}));

const registerNonDuplicatesGlobalMock = jest.fn(async () => makeDisposer("global:nonDuplicates"));
const registerNonDuplicatesWindowMock = jest.fn(async (win: any) => makeDisposer(`window:${win.name}:nonDuplicates`));
jest.mock("../src/features/nonDuplicates", () => ({
  createNonDuplicateButton: jest.fn((_win: Window, id: string) => ({ tag: "button", id })),
  createNonDuplicatesNotifyHandler: jest.fn(() => jest.fn()),
  NonDuplicates: { getInstance: jest.fn(() => ({ allNonDuplicates: new Set() })) },
  registerNonDuplicatesGlobal: registerNonDuplicatesGlobalMock,
  registerNonDuplicatesWindow: registerNonDuplicatesWindowMock,
}));

const registerNotifierMock = jest.fn(() => makeDisposer("global:notifier"));
const notifyDispatcherMock = {
  registerHandler: jest.fn(() => makeDisposer("global:handler")),
  dispatch: jest.fn(),
  setReady: jest.fn(async () => undefined),
  reset: jest.fn(() => order.push("dispatcher:reset")),
};
jest.mock("../src/integrations/zotero/notifier", () => ({
  notifyDispatcher: notifyDispatcherMock,
  registerNotifier: registerNotifierMock,
}));

jest.mock("../src/integrations/zotero/menuCache", () => ({
  createMenuCacheNotifyHandler: jest.fn(() => jest.fn()),
}));

jest.mock("../src/integrations/zotero/windowChrome", () => ({
  registerStyleSheets: jest.fn(),
}));

jest.mock("../src/shared/locale", () => ({
  initLocale: jest.fn(),
}));

jest.mock("../src/shared/debug", () => ({
  debug: jest.fn(),
}));

const closeDbMock = jest.fn(async () => order.push("db:close"));
jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: {
      init: jest.fn(async () => undefined),
      close: closeDbMock,
    },
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

    jest.useRealTimers();
  });
});
