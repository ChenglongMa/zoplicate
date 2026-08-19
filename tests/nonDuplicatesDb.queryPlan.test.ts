import { afterAll, describe, expect, jest, test } from "@jest/globals";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const sqlite = new DatabaseSync(":memory:");

const queryAsync = jest.fn(async (sql: string, params: SQLInputValue[] = []) => {
  const statement = sqlite.prepare(sql);
  if (/^\s*(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)) {
    return statement.all(...params);
  }
  statement.run(...params);
  return [];
});

(globalThis as any).Zotero.DBConnection = jest.fn(() => ({
  queryAsync,
  closeDatabase: jest.fn(async () => undefined),
  executeTransaction: jest.fn(async (fn: () => Promise<unknown>) => {
    sqlite.exec("BEGIN");
    try {
      const result = await fn();
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }),
}));

import { NonDuplicatesDB } from "../src/db/nonDuplicates";

afterAll(() => {
  sqlite.close();
});

describe("NonDuplicatesDB item lookup query plan", () => {
  test("uses both item indexes instead of scanning all non-duplicate rows", async () => {
    await NonDuplicatesDB.instance.init();

    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT itemID, itemID2
         FROM nonDuplicates
         WHERE itemID = ? OR itemID2 = ?`,
      )
      .all(42, 42) as Array<{ detail: string }>;
    const details = plan.map(({ detail }) => detail);

    expect(details.some((detail) => detail.includes("MULTI-INDEX OR"))).toBe(true);
    expect(details.some((detail) => detail.includes("idx_nonDuplicates_itemID2"))).toBe(true);
    expect(details.some((detail) => detail.includes("sqlite_autoindex_nonDuplicates_1"))).toBe(true);
    expect(details.some((detail) => /^SCAN\b/.test(detail))).toBe(false);
  });
});
