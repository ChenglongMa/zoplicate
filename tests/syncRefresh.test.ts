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

import { refreshLocalFromSync } from "../src/features/nonDuplicates/syncRefresh";

const _Zotero = (globalThis as any).Zotero;

beforeEach(() => {
  jest.clearAllMocks();
  queryAsyncMock.mockResolvedValue([]);
  // Default: Items.get returns item-shaped objects with keys
  (_Zotero.Items.get as jest.Mock<any>).mockImplementation((itemID: number) => ({
    id: itemID,
    libraryID: 1,
    key: `KEY${itemID}`,
  }));
});

describe("refreshLocalFromSync", () => {
  test("resolves key pairs to itemIDs and inserts new pairs", async () => {
    // Mock getByLibraryAndKeyAsync to resolve keys to items
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_lib: number, key: string) => {
        const map: Record<string, any> = {
          KEYA: { id: 10, key: "KEYA", libraryID: 1 },
          KEYB: { id: 20, key: "KEYB", libraryID: 1 },
        };
        return map[key] || false;
      },
    );

    // Local DB has no existing pairs for this library
    queryAsyncMock.mockResolvedValueOnce([]); // getNonDuplicateKeys

    await refreshLocalFromSync(1, [["KEYA", "KEYB"]]);

    // Should have called insertNonDuplicatePair (via INSERT OR IGNORE)
    const insertCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("removes local pairs not in remote payload", async () => {
    // Mock key resolution
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_lib: number, key: string) => {
        const map: Record<string, any> = {
          KEYA: { id: 10, key: "KEYA", libraryID: 1 },
          KEYB: { id: 20, key: "KEYB", libraryID: 1 },
          KEYC: { id: 30, key: "KEYC", libraryID: 1 },
          KEYD: { id: 40, key: "KEYD", libraryID: 1 },
        };
        return map[key] || false;
      },
    );

    // Local DB has [KEYA,KEYB] and [KEYC,KEYD]; remote only has [KEYA,KEYB]
    queryAsyncMock.mockResolvedValueOnce([
      { itemKey: "KEYA", itemKey2: "KEYB" },
      { itemKey: "KEYC", itemKey2: "KEYD" },
    ]);

    await refreshLocalFromSync(1, [["KEYA", "KEYB"]]);

    // Should have a DELETE call for the stale pair (KEYC,KEYD) -> (30,40)
    const deleteCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  test("unresolvable keys are skipped gracefully", async () => {
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_lib: number, key: string) => {
        if (key === "KEYA") return { id: 10, key: "KEYA", libraryID: 1 };
        return false; // KEYB is unresolvable
      },
    );

    queryAsyncMock.mockResolvedValueOnce([]); // no local pairs

    // Should not throw
    await refreshLocalFromSync(1, [["KEYA", "KEYB"]]);

    // No insert should happen since one key is unresolvable
    const insertCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    );
    expect(insertCalls.length).toBe(0);
  });

  test("empty remote payload clears local pairs for library", async () => {
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_lib: number, key: string) => {
        const map: Record<string, any> = {
          KEYA: { id: 10, key: "KEYA", libraryID: 1 },
          KEYB: { id: 20, key: "KEYB", libraryID: 1 },
        };
        return map[key] || false;
      },
    );

    // Local has one pair
    queryAsyncMock.mockResolvedValueOnce([
      { itemKey: "KEYA", itemKey2: "KEYB" },
    ]);

    await refreshLocalFromSync(1, []);

    // Should delete the local pair
    const deleteCalls = queryAsyncMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});
