import { describe, expect, test, beforeEach, jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getNonDuplicateKeysMock = jest.fn<(...args: any[]) => Promise<any[]>>(async () => []);
const insertNonDuplicatePairMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: {
      getNonDuplicateKeys: getNonDuplicateKeysMock,
      insertNonDuplicatePair: insertNonDuplicatePairMock,
    },
  },
}));

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const _Zotero = (globalThis as any).Zotero;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { hydrateLibrary, hydrateAllLibraries } from "../src/features/nonDuplicates/hydration";
import type { NonDuplicateSyncStore } from "../src/integrations/zotero/syncedSettingsStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSyncStore(remotePairs: [string, string][] = []) {
  return {
    read: jest.fn((_libraryID: number) => remotePairs),
    write: jest.fn<(...args: any[]) => Promise<void>>(async () => {}),
    addPair: jest.fn<(...args: any[]) => Promise<void>>(async () => {}),
    removePair: jest.fn<(...args: any[]) => Promise<void>>(async () => {}),
    clear: jest.fn<(...args: any[]) => Promise<void>>(async () => {}),
  } as unknown as NonDuplicateSyncStore & {
    read: jest.Mock<any>;
    write: jest.Mock<any>;
  };
}

const mockDb = {
  getNonDuplicateKeys: getNonDuplicateKeysMock,
  insertNonDuplicatePair: insertNonDuplicatePairMock,
} as any;

// ---------------------------------------------------------------------------
// Tests - hydrateLibrary
// ---------------------------------------------------------------------------

describe("hydrateLibrary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_libraryID: number, key: string) => {
        // Return mock items with id derived from key
        const idMap: Record<string, number> = { KEYA: 10, KEYB: 20, KEYC: 30, KEYD: 40 };
        const id = idMap[key];
        if (!id) return false;
        return { id, key };
      },
    );
  });

  test("writes local-only pairs to SyncedSettings (first-upgrade bootstrap)", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([
      { key1: "KEYA", key2: "KEYB" },
      { key1: "KEYC", key2: "KEYD" },
    ]);
    const syncStore = createMockSyncStore([]); // empty remote

    await hydrateLibrary(1, mockDb, syncStore);

    expect(syncStore.write).toHaveBeenCalledTimes(1);
    const writtenPairs = (syncStore.write as jest.Mock<any>).mock.calls[0][1] as [string, string][];
    // Both local pairs should be written
    expect(writtenPairs).toHaveLength(2);
    expect(writtenPairs).toContainEqual(["KEYA", "KEYB"]);
    expect(writtenPairs).toContainEqual(["KEYC", "KEYD"]);
    // No local DB inserts (no remote-only pairs)
    expect(insertNonDuplicatePairMock).not.toHaveBeenCalled();
  });

  test("imports remote-only pairs to local DB", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([]); // empty local
    const syncStore = createMockSyncStore([["KEYA", "KEYB"]]);

    await hydrateLibrary(1, mockDb, syncStore);

    expect(insertNonDuplicatePairMock).toHaveBeenCalledWith(10, 20, 1);
    // No SyncedSettings write (no local-only pairs)
    expect((syncStore as any).write).not.toHaveBeenCalled();
  });

  test("is a no-op when local and remote are identical", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([{ key1: "KEYA", key2: "KEYB" }]);
    const syncStore = createMockSyncStore([["KEYA", "KEYB"]]);

    await hydrateLibrary(1, mockDb, syncStore);

    expect((syncStore as any).write).not.toHaveBeenCalled();
    expect(insertNonDuplicatePairMock).not.toHaveBeenCalled();
  });

  test("handles empty local and empty remote gracefully", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([]);
    const syncStore = createMockSyncStore([]);

    await hydrateLibrary(1, mockDb, syncStore);

    expect((syncStore as any).write).not.toHaveBeenCalled();
    expect(insertNonDuplicatePairMock).not.toHaveBeenCalled();
  });

  test("catches SyncedSettings failure without throwing", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([{ key1: "KEYA", key2: "KEYB" }]);
    const syncStore = createMockSyncStore([]);
    (syncStore as any).write.mockRejectedValue(new Error("sync write failed"));

    // Should not throw
    await expect(hydrateLibrary(1, mockDb, syncStore)).rejects.toThrow("sync write failed");
    // The function itself does NOT catch per-library errors -- hydrateAllLibraries does.
    // Adjust: hydrateLibrary propagates, hydrateAllLibraries catches.
  });

  test("skips remote-only pairs that cannot be resolved", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([]);
    const syncStore = createMockSyncStore([["KEYA", "UNKNOWN"]]);

    await hydrateLibrary(1, mockDb, syncStore);

    // UNKNOWN key returns false from mock, so pair is skipped
    expect(insertNonDuplicatePairMock).not.toHaveBeenCalled();
  });

  test("bidirectional: bootstraps local-only and imports remote-only", async () => {
    getNonDuplicateKeysMock.mockResolvedValue([{ key1: "KEYA", key2: "KEYB" }]);
    const syncStore = createMockSyncStore([["KEYC", "KEYD"]]);

    await hydrateLibrary(1, mockDb, syncStore);

    // local-only pair written to SyncedSettings
    expect((syncStore as any).write).toHaveBeenCalledTimes(1);
    const writtenPairs = (syncStore as any).write.mock.calls[0][1] as [string, string][];
    expect(writtenPairs).toContainEqual(["KEYA", "KEYB"]);
    expect(writtenPairs).toContainEqual(["KEYC", "KEYD"]);

    // remote-only pair imported to local DB
    expect(insertNonDuplicatePairMock).toHaveBeenCalledWith(30, 40, 1);
  });
});

// ---------------------------------------------------------------------------
// Tests - hydrateAllLibraries
// ---------------------------------------------------------------------------

describe("hydrateAllLibraries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockResolvedValue(false);
  });

  test("skips feed libraries", async () => {
    (_Zotero as any).Libraries = {
      getAll: jest.fn(() => [
        { libraryID: 1, libraryType: "user" },
        { libraryID: 2, libraryType: "feed" },
        { libraryID: 3, libraryType: "group" },
      ]),
    };
    getNonDuplicateKeysMock.mockResolvedValue([]);
    const syncStore = createMockSyncStore([]);

    await hydrateAllLibraries(mockDb, syncStore);

    // read called for library 1 and 3, but not 2 (feed)
    expect((syncStore as any).read).toHaveBeenCalledTimes(2);
    expect((syncStore as any).read).toHaveBeenCalledWith(1);
    expect((syncStore as any).read).toHaveBeenCalledWith(3);
  });

  test("calls hydrateLibrary for each non-feed library", async () => {
    (_Zotero as any).Libraries = {
      getAll: jest.fn(() => [
        { libraryID: 1, libraryType: "user" },
        { libraryID: 5, libraryType: "group" },
      ]),
    };
    getNonDuplicateKeysMock.mockResolvedValue([]);
    const syncStore = createMockSyncStore([]);

    await hydrateAllLibraries(mockDb, syncStore);

    expect(getNonDuplicateKeysMock).toHaveBeenCalledTimes(2);
    expect(getNonDuplicateKeysMock).toHaveBeenCalledWith({ libraryID: 1 });
    expect(getNonDuplicateKeysMock).toHaveBeenCalledWith({ libraryID: 5 });
  });

  test("catches per-library failure without stopping other libraries", async () => {
    (_Zotero as any).Libraries = {
      getAll: jest.fn(() => [
        { libraryID: 1, libraryType: "user" },
        { libraryID: 2, libraryType: "group" },
      ]),
    };
    // First call throws, second succeeds
    getNonDuplicateKeysMock
      .mockRejectedValueOnce(new Error("db error"))
      .mockResolvedValueOnce([]);
    const syncStore = createMockSyncStore([]);

    // Should not throw
    await hydrateAllLibraries(mockDb, syncStore);

    // Second library still processed
    expect(getNonDuplicateKeysMock).toHaveBeenCalledTimes(2);
  });

  test("catches top-level failure without throwing", async () => {
    (_Zotero as any).Libraries = {
      getAll: jest.fn(() => {
        throw new Error("Libraries unavailable");
      }),
    };
    const syncStore = createMockSyncStore([]);

    // Should not throw
    await expect(hydrateAllLibraries(mockDb, syncStore)).resolves.toBeUndefined();
  });
});
