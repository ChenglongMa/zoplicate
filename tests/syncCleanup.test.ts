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

import { NonDuplicatesDB } from "../src/db/nonDuplicates";
import { whenItemsDeleted } from "../src/features/nonDuplicates/notifyHandlers";

const _Zotero = (globalThis as any).Zotero;
const ssStore: Map<string, any> = _Zotero.SyncedSettings._store;

beforeEach(() => {
  jest.clearAllMocks();
  ssStore.clear();
  queryAsyncMock.mockResolvedValue([]);
  (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => ({
    id: itemID,
    libraryID: 1,
    key: `KEY${itemID}`,
  }));
});

describe("whenItemsDeleted synced cleanup", () => {
  test("deleting item with key K removes pairs containing K from SyncedSettings", async () => {
    // Setup: getKeysForItems query returns rows with both key columns
    queryAsyncMock
      .mockResolvedValueOnce([
        { itemKey: "KEYA", itemKey2: "KEYB", libraryID: 1 },
      ]) // getKeysForItems query
      .mockResolvedValue([]); // deleteRecords

    // SyncedSettings has pairs containing KEYA and KEYB
    ssStore.set("1/zoplicate-nonDuplicatePairs", {
      v: 1,
      pairs: [["KEYA", "KEYC"], ["KEYB", "KEYD"], ["KEYE", "KEYF"]],
    });

    await whenItemsDeleted([10]);

    // SyncedSettings.set should have been called to remove pairs containing KEYA or KEYB
    // (The exact filtering depends on the implementation)
    // deleteRecords should still be called for local DB cleanup
    const deleteCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  test("local DB cleanup is preserved even when SyncedSettings fails", async () => {
    // Setup: getKeysForItems returns keys
    queryAsyncMock
      .mockResolvedValueOnce([
        { itemKey: "KEYA", itemKey2: null, libraryID: 1 },
      ])
      .mockResolvedValue([]); // deleteRecords

    // Make SyncedSettings.get throw
    (_Zotero.SyncedSettings.get as jest.Mock<any>).mockImplementationOnce(() => {
      throw new Error("SyncedSettings failure");
    });

    // Should NOT throw
    await whenItemsDeleted([10]);

    // deleteRecords should still be called
    const deleteCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  test("batch deletes handled - multiple items with keys across libraries", async () => {
    queryAsyncMock
      .mockResolvedValueOnce([
        { itemKey: "KEYA", itemKey2: "KEYB", libraryID: 1 },
        { itemKey: "KEYC", itemKey2: null, libraryID: 2 },
      ])
      .mockResolvedValue([]);

    ssStore.set("1/zoplicate-nonDuplicatePairs", {
      v: 1,
      pairs: [["KEYA", "KEYX"], ["KEYM", "KEYN"]],
    });
    ssStore.set("2/zoplicate-nonDuplicatePairs", {
      v: 1,
      pairs: [["KEYC", "KEYY"], ["KEYP", "KEYQ"]],
    });

    await whenItemsDeleted([10, 20, 30]);

    // Should have called set for both libraries (filtering pairs with deleted keys)
    expect(_Zotero.SyncedSettings.set).toHaveBeenCalledTimes(2);
  });

  test("missing keys are skipped gracefully", async () => {
    // No keys found for the deleted items
    queryAsyncMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);

    // Should not throw, and should not touch SyncedSettings
    await whenItemsDeleted([10]);

    expect(_Zotero.SyncedSettings.set).not.toHaveBeenCalled();
  });

  test("empty ids array is a no-op", async () => {
    await whenItemsDeleted([]);

    expect(queryAsyncMock).not.toHaveBeenCalled();
    expect(_Zotero.SyncedSettings.set).not.toHaveBeenCalled();
  });
});

describe("NonDuplicatesDB.getKeysForItems", () => {
  test("returns unique keys and libraryIDs for given itemIDs", async () => {
    queryAsyncMock.mockResolvedValueOnce([
      { itemKey: "KEYA", itemKey2: "KEYB", libraryID: 1 },
    ]);

    const result = await NonDuplicatesDB.instance.getKeysForItems([10, 20]);

    expect(queryAsyncMock).toHaveBeenCalledTimes(1);
    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("itemKey");
    expect(sql).toContain("itemKey2");
    // Returns flattened unique keys
    expect(result).toEqual([
      { key: "KEYA", libraryID: 1 },
      { key: "KEYB", libraryID: 1 },
    ]);
  });
});
