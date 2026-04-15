import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const queryAsyncMock = jest.fn<(...args: any[]) => Promise<any>>(async () => []);
const closeDatabaseMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const executeTransactionMock = jest.fn<(fn: () => Promise<any>) => Promise<any>>(async (fn) => fn());

(globalThis as any).Zotero.DBConnection = jest.fn(() => ({
  queryAsync: queryAsyncMock,
  closeDatabase: closeDatabaseMock,
  executeTransaction: executeTransactionMock,
}));

import { NonDuplicatesDB } from "../src/db/nonDuplicates";

const _Zotero = (globalThis as any).Zotero;

beforeEach(() => {
  jest.clearAllMocks();
  queryAsyncMock.mockResolvedValue([]);
  (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => ({
    id: itemID,
    libraryID: 88,
    key: `KEY${itemID}`,
  }));
});

describe("NonDuplicatesDB SQL behavior", () => {
  test("insertNonDuplicatePair skips self-pairs", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicatePair(10, 10, 1);

    expect(queryAsyncMock).not.toHaveBeenCalled();
  });

  test("insertNonDuplicates expands all pairs with keys and normalizes item order", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicates([3, 1, 2], 77);

    expect(queryAsyncMock).toHaveBeenCalledTimes(1);
    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT OR IGNORE INTO nonDuplicates");
    expect(sql).toContain("itemKey, itemKey2");
    // Pairs: (1,3), (2,3), (1,2) — each with libraryID 77 and resolved keys
    expect(queryAsyncMock.mock.calls[0][1]).toEqual([
      1, 3, 77, "KEY1", "KEY3",
      2, 3, 77, "KEY2", "KEY3",
      1, 2, 77, "KEY1", "KEY2",
    ]);
  });

  test("insertNonDuplicatePair resolves and stores item keys", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicatePair(10, 20, 1);

    expect(queryAsyncMock).toHaveBeenCalledTimes(1);
    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("itemKey, itemKey2");
    // itemID 10 < 20, so order is preserved: [10, 20, 1, KEY10, KEY20]
    expect(queryAsyncMock.mock.calls[0][1]).toEqual([10, 20, 1, "KEY10", "KEY20"]);
  });

  test("insertNonDuplicatePair normalizes key order when itemID > itemID2", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicatePair(20, 10, 1);

    // itemID 20 > 10, so order is swapped: [10, 20, 1, KEY10, KEY20]
    expect(queryAsyncMock.mock.calls[0][1]).toEqual([10, 20, 1, "KEY10", "KEY20"]);
  });

  test("insertNonDuplicatePair stores null key when item has no key", async () => {
    (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => {
      if (itemID === 10) return { id: 10, libraryID: 88, key: "KEY10" };
      return { id: 20, libraryID: 88 }; // no key property
    });

    await NonDuplicatesDB.instance.insertNonDuplicatePair(10, 20, 1);

    expect(queryAsyncMock.mock.calls[0][1]).toEqual([10, 20, 1, "KEY10", null]);
  });

  test("deleteNonDuplicates deletes every pair in both item orders", async () => {
    await NonDuplicatesDB.instance.deleteNonDuplicates([3, 1, 2]);

    expect(queryAsyncMock).toHaveBeenCalledTimes(1);
    expect(queryAsyncMock.mock.calls[0][0]).toContain("DELETE");
    expect(queryAsyncMock.mock.calls[0][0]).toContain("FROM nonDuplicates");
    expect(queryAsyncMock.mock.calls[0][1]).toEqual([3, 1, 1, 3, 3, 2, 2, 3, 1, 2, 2, 1]);
  });

  test("existsNonDuplicates returns true only when every pair exists", async () => {
    queryAsyncMock.mockResolvedValueOnce([{ count: 3 }]);
    await expect(NonDuplicatesDB.instance.existsNonDuplicates([1, 2, 3])).resolves.toBe(true);

    queryAsyncMock.mockResolvedValueOnce([{ count: 2 }]);
    await expect(NonDuplicatesDB.instance.existsNonDuplicates([1, 2, 3])).resolves.toBe(false);
  });

  test("getNonDuplicates can query by library", async () => {
    queryAsyncMock.mockResolvedValueOnce([{ itemID: 1, itemID2: 2 }]);

    await expect(NonDuplicatesDB.instance.getNonDuplicates({ libraryID: 42 })).resolves.toEqual([
      { itemID: 1, itemID2: 2 },
    ]);

    expect(queryAsyncMock).toHaveBeenCalledWith(expect.stringContaining("WHERE libraryID = ?"), [42]);
  });

  test("getNonDuplicates can query by itemID", async () => {
    queryAsyncMock.mockResolvedValueOnce([{ itemID: 5, itemID2: 10 }]);

    await expect(NonDuplicatesDB.instance.getNonDuplicates({ itemID: 5 })).resolves.toEqual([
      { itemID: 5, itemID2: 10 },
    ]);

    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("WHERE");
    expect(sql).toContain("itemID = ?");
    expect(sql).toContain("itemID2 = ?");
    expect(queryAsyncMock).toHaveBeenCalledWith(expect.any(String), [5, 5]);
  });

  test("getNonDuplicates combines itemID and libraryID filters with AND", async () => {
    queryAsyncMock.mockResolvedValueOnce([{ itemID: 5, itemID2: 10 }]);

    await NonDuplicatesDB.instance.getNonDuplicates({ itemID: 5, libraryID: 42 });

    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("itemID = ?");
    expect(sql).toContain("libraryID = ?");
    expect(sql).not.toMatch(/WHERE.*WHERE/);
    expect(sql).toContain("AND");
    expect(queryAsyncMock).toHaveBeenCalledWith(expect.any(String), [5, 5, 42]);
  });

  test("getNonDuplicates with no filters returns all rows", async () => {
    queryAsyncMock.mockResolvedValueOnce([]);

    await NonDuplicatesDB.instance.getNonDuplicates({});

    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).not.toContain("WHERE");
    expect(queryAsyncMock).toHaveBeenCalledWith(expect.any(String), []);
  });

  test("getNonDuplicateKeys returns key pairs for a library", async () => {
    queryAsyncMock.mockResolvedValueOnce([
      { itemKey: "KEYA", itemKey2: "KEYB" },
      { itemKey: "KEYC", itemKey2: "KEYD" },
    ]);

    const result = await NonDuplicatesDB.instance.getNonDuplicateKeys({ libraryID: 1 });

    expect(result).toEqual([
      { key1: "KEYA", key2: "KEYB" },
      { key1: "KEYC", key2: "KEYD" },
    ]);
    const sql = queryAsyncMock.mock.calls[0][0] as string;
    expect(sql).toContain("itemKey IS NOT NULL");
    expect(sql).toContain("itemKey2 IS NOT NULL");
    expect(sql).toContain("libraryID = ?");
  });
});
