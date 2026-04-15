import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const queryAsyncMock = jest.fn<(...args: any[]) => Promise<any>>(async () => []);
const closeDatabaseMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);

(globalThis as any).Zotero.DBConnection = jest.fn(() => ({
  queryAsync: queryAsyncMock,
  closeDatabase: closeDatabaseMock,
}));

import { NonDuplicatesDB } from "../src/db/nonDuplicates";

const _Zotero = (globalThis as any).Zotero;

beforeEach(() => {
  jest.clearAllMocks();
  queryAsyncMock.mockResolvedValue([]);
  (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => ({ id: itemID, libraryID: 88 }));
});

describe("NonDuplicatesDB SQL behavior", () => {
  test("init creates the nonDuplicates table", async () => {
    await NonDuplicatesDB.instance.init();

    expect(queryAsyncMock).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS nonDuplicates"));
  });

  test("insertNonDuplicatePair skips self-pairs", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicatePair(10, 10, 1);

    expect(queryAsyncMock).not.toHaveBeenCalled();
  });

  test("insertNonDuplicates expands all pairs and normalizes item order", async () => {
    await NonDuplicatesDB.instance.insertNonDuplicates([3, 1, 2], 77);

    expect(queryAsyncMock).toHaveBeenCalledTimes(1);
    expect(queryAsyncMock.mock.calls[0][0]).toContain("INSERT OR IGNORE INTO nonDuplicates");
    expect(queryAsyncMock.mock.calls[0][1]).toEqual([1, 3, 77, 2, 3, 77, 1, 2, 77]);
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
});
