import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// ---------------------------------------------------------------------------
// DB mock setup (must precede module import)
// ---------------------------------------------------------------------------

const queryAsyncMock = jest.fn<(...args: any[]) => Promise<any>>(async () => []);
const closeDatabaseMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const executeTransactionMock = jest.fn<(fn: () => Promise<any>) => Promise<any>>(async (fn) => fn());

(globalThis as any).Zotero.DBConnection = jest.fn(() => ({
  queryAsync: queryAsyncMock,
  closeDatabase: closeDatabaseMock,
  executeTransaction: executeTransactionMock,
}));

// Mock refreshLocalFromSync
const refreshLocalFromSyncMock = jest.fn<(...args: any[]) => Promise<void>>(async () => {});

jest.mock("../src/features/nonDuplicates/syncRefresh", () => ({
  refreshLocalFromSync: refreshLocalFromSyncMock,
}));

import { registerSyncListener } from "../src/features/nonDuplicates/syncListener";

const _Zotero = (globalThis as any).Zotero;
const ssStore: Map<string, any> = _Zotero.SyncedSettings._store;

type ListenerCallback = (old: any, nw: any, conflict: boolean) => Promise<void>;

/** Helper to extract the registered callback from the addListener mock. */
function getRegisteredCallback(): ListenerCallback {
  const calls = (_Zotero.SyncedSettings.onSyncDownload.addListener as jest.Mock<any>).mock.calls;
  return calls[calls.length - 1][2] as ListenerCallback;
}

beforeEach(() => {
  jest.clearAllMocks();
  ssStore.clear();
  queryAsyncMock.mockResolvedValue([]);
});

describe("registerSyncListener", () => {
  test("addListener is called with correct libraryID and SETTING_KEY", () => {
    registerSyncListener(1);

    expect(_Zotero.SyncedSettings.onSyncDownload.addListener).toHaveBeenCalledTimes(1);
    const args = (_Zotero.SyncedSettings.onSyncDownload.addListener as jest.Mock<any>).mock.calls[0];
    expect(args[0]).toBe(1); // libraryID
    expect(args[1]).toBe("zoplicate-nonDuplicatePairs"); // SETTING_KEY
    expect(typeof args[2]).toBe("function"); // callback fn
  });

  test("conflict=false calls refreshLocalFromSync with new remote pairs", async () => {
    registerSyncListener(1);
    const callback = getRegisteredCallback();

    const oldValue = { v: 1, pairs: [["A", "B"]] };
    const newValue = { v: 1, pairs: [["C", "D"]] };

    await callback(oldValue, newValue, false);

    expect(refreshLocalFromSyncMock).toHaveBeenCalledWith(1, [["C", "D"]]);
  });

  test("conflict=true writes back union-merged result via set() with version=0 then refreshes", async () => {
    registerSyncListener(1);
    const callback = getRegisteredCallback();

    // oldValue = previous local (unsaved), newValue = remote (already persisted)
    const oldValue = { v: 1, pairs: [["A", "B"]] };
    const newValue = { v: 1, pairs: [["C", "D"]] };

    await callback(oldValue, newValue, true);

    // Should call set() with merged pairs and version=0
    expect(_Zotero.SyncedSettings.set).toHaveBeenCalledTimes(1);
    const setArgs = (_Zotero.SyncedSettings.set as jest.Mock<any>).mock.calls[0];
    expect(setArgs[0]).toBe(1); // libraryID
    expect(setArgs[1]).toBe("zoplicate-nonDuplicatePairs");
    // The merged payload should contain both pairs, sorted
    const mergedPayload = setArgs[2] as { v: number; pairs: [string, string][] };
    expect(mergedPayload.v).toBe(1);
    expect(mergedPayload.pairs).toEqual([["A", "B"], ["C", "D"]]);
    // version=0 is critical to prevent re-triggering onSyncDownload
    expect(setArgs[3]).toBe(0);

    // Should also call refreshLocalFromSync with merged pairs
    expect(refreshLocalFromSyncMock).toHaveBeenCalledWith(1, [["A", "B"], ["C", "D"]]);
  });

  test("after disposal, listener callback is no-op", async () => {
    const dispose = registerSyncListener(1);
    const callback = getRegisteredCallback();

    // Dispose the listener
    dispose();

    const newValue = { v: 1, pairs: [["X", "Y"]] };
    await callback(null, newValue, false);

    // refreshLocalFromSync should NOT have been called
    expect(refreshLocalFromSyncMock).not.toHaveBeenCalled();
  });

  test("handles null/undefined newValue gracefully", async () => {
    registerSyncListener(1);
    const callback = getRegisteredCallback();

    // Should not throw
    await callback(null, null, false);
    await callback(null, undefined, false);

    // refreshLocalFromSync should be called with empty pairs
    expect(refreshLocalFromSyncMock).toHaveBeenCalledTimes(2);
    expect(refreshLocalFromSyncMock).toHaveBeenCalledWith(1, []);
  });
});
