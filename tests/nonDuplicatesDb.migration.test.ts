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

/** Helper: extract all SQL statements sent to queryAsync */
function allSqlCalls(): string[] {
  return queryAsyncMock.mock.calls.map((call) => call[0] as string);
}

describe("NonDuplicatesDB schema versioning and migration", () => {
  test("init creates table, checks schema version, and runs migration for fresh install", async () => {
    // getSchemaVersion: table doesn't exist yet (throws), returns 0
    // Then migration runs, then setSchemaVersion
    await NonDuplicatesDB.instance.init();

    const sqls = allSqlCalls();
    // 1. Creates nonDuplicates table
    expect(sqls.some((s) => s.includes("CREATE TABLE IF NOT EXISTS nonDuplicates"))).toBe(true);
    // 2. Reads schema version (first call returns empty = version 0)
    expect(sqls.some((s) => s.includes("SELECT version FROM schemaVersion"))).toBe(true);
    // 3. Migration runs inside transaction
    expect(executeTransactionMock).toHaveBeenCalled();
  });

  test("migration v0→v1 adds itemKey and itemKey2 columns", async () => {
    // PRAGMA table_info returns columns without itemKey/itemKey2
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT version FROM schemaVersion")) return [];
      if (sql.includes("PRAGMA table_info")) {
        return [{ name: "itemID" }, { name: "itemID2" }, { name: "libraryID" }];
      }
      // backfillKeys query: no rows to backfill
      if (sql.includes("WHERE itemKey IS NULL")) return [];
      return [];
    });

    await NonDuplicatesDB.instance.init();

    const sqls = allSqlCalls();
    expect(sqls.some((s) => s.includes("ALTER TABLE nonDuplicates ADD COLUMN itemKey TEXT"))).toBe(true);
    expect(sqls.some((s) => s.includes("ALTER TABLE nonDuplicates ADD COLUMN itemKey2 TEXT"))).toBe(true);
    expect(sqls.some((s) => s.includes("CREATE INDEX IF NOT EXISTS idx_nonDuplicates_libraryID"))).toBe(true);
  });

  test("migration v0→v1 is idempotent when columns already exist", async () => {
    // PRAGMA table_info returns columns WITH itemKey/itemKey2
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT version FROM schemaVersion")) return [];
      if (sql.includes("PRAGMA table_info")) {
        return [
          { name: "itemID" },
          { name: "itemID2" },
          { name: "libraryID" },
          { name: "itemKey" },
          { name: "itemKey2" },
        ];
      }
      if (sql.includes("WHERE itemKey IS NULL")) return [];
      return [];
    });

    await NonDuplicatesDB.instance.init();

    const sqls = allSqlCalls();
    // ALTER TABLE should NOT be called since columns already exist
    expect(sqls.filter((s) => s.includes("ALTER TABLE")).length).toBe(0);
    // But index creation should still happen (IF NOT EXISTS is safe)
    expect(sqls.some((s) => s.includes("CREATE INDEX IF NOT EXISTS"))).toBe(true);
  });

  test("migration sets schema version to target after success", async () => {
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT version FROM schemaVersion")) return [];
      if (sql.includes("PRAGMA table_info")) {
        return [{ name: "itemID" }, { name: "itemID2" }, { name: "libraryID" }];
      }
      if (sql.includes("WHERE itemKey IS NULL")) return [];
      return [];
    });

    await NonDuplicatesDB.instance.init();

    const sqls = allSqlCalls();
    // Should create schemaVersion table
    expect(sqls.some((s) => s.includes("CREATE TABLE IF NOT EXISTS schemaVersion"))).toBe(true);
    // Should insert version 1
    expect(
      queryAsyncMock.mock.calls.some(
        (call) =>
          (call[0] as string).includes("INSERT INTO schemaVersion") &&
          (call[1] as number[])?.[0] === NonDuplicatesDB.SCHEMA_VERSION,
      ),
    ).toBe(true);
  });

  test("init skips migration when schema version is current", async () => {
    // Return current version from schemaVersion table
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT version FROM schemaVersion")) {
        return [{ version: NonDuplicatesDB.SCHEMA_VERSION }];
      }
      return [];
    });

    await NonDuplicatesDB.instance.init();

    const sqls = allSqlCalls();
    // Should NOT run ALTER TABLE or PRAGMA table_info
    expect(sqls.some((s) => s.includes("ALTER TABLE"))).toBe(false);
    expect(sqls.some((s) => s.includes("PRAGMA table_info"))).toBe(false);
    // Should NOT run executeTransaction for migration
    expect(executeTransactionMock).not.toHaveBeenCalled();
  });

  test("migration runs inside a transaction", async () => {
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT version FROM schemaVersion")) return [];
      if (sql.includes("PRAGMA table_info")) {
        return [{ name: "itemID" }, { name: "itemID2" }, { name: "libraryID" }];
      }
      if (sql.includes("WHERE itemKey IS NULL")) return [];
      return [];
    });

    await NonDuplicatesDB.instance.init();

    expect(executeTransactionMock).toHaveBeenCalled();
    // The transaction function should have been called with a function
    const txFn = executeTransactionMock.mock.calls[0][0];
    expect(typeof txFn).toBe("function");
  });
});

describe("NonDuplicatesDB backfillKeys", () => {
  test("backfillKeys resolves keys for rows with null keys", async () => {
    // First call in init chain returns data for backfill
    const callTracker: string[] = [];
    queryAsyncMock.mockImplementation(async (sql: string, params?: any[]) => {
      callTracker.push(sql);
      if (sql.includes("SELECT version FROM schemaVersion")) return [{ version: 1 }];
      if (sql.includes("WHERE itemKey IS NULL")) {
        return [
          { itemID: 1, itemID2: 2, libraryID: 88 },
          { itemID: 3, itemID2: 4, libraryID: 88 },
        ];
      }
      return [];
    });

    // Call backfillKeys directly
    await NonDuplicatesDB.instance.backfillKeys();

    // Should update both rows with resolved keys
    const updateCalls = queryAsyncMock.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE") && (call[0] as string).includes("itemKey"),
    );
    expect(updateCalls.length).toBe(2);
    expect(updateCalls[0][1]).toEqual(["KEY1", "KEY2", 1, 2]);
    expect(updateCalls[1][1]).toEqual(["KEY3", "KEY4", 3, 4]);
  });

  test("backfillKeys deletes rows where items no longer exist", async () => {
    (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => {
      if (itemID === 1) return { id: 1, libraryID: 88, key: "KEY1" };
      if (itemID === 2) return { id: 2, libraryID: 88, key: "KEY2" };
      // Items 3 and 4 no longer exist
      return null;
    });

    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE itemKey IS NULL")) {
        return [
          { itemID: 1, itemID2: 2, libraryID: 88 }, // Both exist
          { itemID: 3, itemID2: 4, libraryID: 88 }, // Both missing
        ];
      }
      return [];
    });

    await NonDuplicatesDB.instance.backfillKeys();

    // Should delete the orphan row
    const deleteCalls = queryAsyncMock.mock.calls.filter((call) =>
      (call[0] as string).includes("DELETE FROM nonDuplicates"),
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][1]).toEqual([3, 4]);

    // Should update the valid row
    const updateCalls = queryAsyncMock.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE") && (call[0] as string).includes("itemKey"),
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][1]).toEqual(["KEY1", "KEY2", 1, 2]);
  });

  test("backfillKeys is a no-op when all rows have keys", async () => {
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE itemKey IS NULL")) return [];
      return [];
    });

    await NonDuplicatesDB.instance.backfillKeys();

    // Should only have the SELECT query, no UPDATE or DELETE
    const updateCalls = queryAsyncMock.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE") || (call[0] as string).includes("DELETE"),
    );
    expect(updateCalls.length).toBe(0);
  });

  test("backfillKeys wraps delete and update in a transaction", async () => {
    queryAsyncMock.mockImplementation(async (sql: string) => {
      if (sql.includes("WHERE itemKey IS NULL")) {
        return [{ itemID: 1, itemID2: 2, libraryID: 88 }];
      }
      return [];
    });

    await NonDuplicatesDB.instance.backfillKeys();

    expect(executeTransactionMock).toHaveBeenCalled();
  });
});
