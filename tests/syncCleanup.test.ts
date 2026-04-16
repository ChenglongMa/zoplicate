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

beforeEach(() => {
  jest.clearAllMocks();
  queryAsyncMock.mockResolvedValue([]);
  (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => ({
    id: itemID,
    libraryID: 1,
    key: `KEY${itemID}`,
  }));
});

describe("whenItemsDeleted local cleanup", () => {
  test("deleting items removes local non-duplicate records only", async () => {
    await whenItemsDeleted([10]);

    const deleteCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(_Zotero.SyncedSettings.get).not.toHaveBeenCalled();
    expect(_Zotero.SyncedSettings.set).not.toHaveBeenCalled();
    expect(_Zotero.SyncedSettings.clear).not.toHaveBeenCalled();
  });

  test("empty ids array is a no-op", async () => {
    await whenItemsDeleted([]);

    expect(queryAsyncMock).not.toHaveBeenCalled();
    expect(_Zotero.SyncedSettings.set).not.toHaveBeenCalled();
    expect(_Zotero.SyncedSettings.clear).not.toHaveBeenCalled();
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
