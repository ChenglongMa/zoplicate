/**
 * End-to-end integration test for non-duplicate sync flow.
 * Tests the full path: mark -> verify both stores -> hydrate -> unmark -> deletion.
 */

import { describe, expect, test, beforeEach, jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const insertNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const deleteNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const insertNonDuplicatePairMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const getNonDuplicateKeysMock = jest.fn<(...args: any[]) => Promise<any[]>>(async () => []);
const deleteRecordsMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
const getKeysForItemsMock = jest.fn<(...args: any[]) => Promise<any[]>>(async () => []);

jest.mock("../src/db/nonDuplicates", () => ({
  NonDuplicatesDB: {
    instance: {
      insertNonDuplicates: insertNonDuplicatesMock,
      deleteNonDuplicates: deleteNonDuplicatesMock,
      insertNonDuplicatePair: insertNonDuplicatePairMock,
      getNonDuplicateKeys: getNonDuplicateKeysMock,
      deleteRecords: deleteRecordsMock,
      getKeysForItems: getKeysForItemsMock,
    },
  },
}));

const invalidateAllMock = jest.fn();
jest.mock("../src/integrations/zotero/menuCache", () => ({
  menuCache: {
    invalidateAll: invalidateAllMock,
    buildKey: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({
  libraryID: 1,
  duplicatesObj: { getSetItemsByItemID: jest.fn(() => []) },
  duplicateItems: [],
}));
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
  areDuplicates: jest.fn(async () => false),
}));

jest.mock("../src/integrations/zotero/windows", () => ({
  isInDuplicatesPane: jest.fn(() => false),
  refreshItemTree: jest.fn(),
  getSelectedItems: jest.fn(() => []),
  getSelectedLibraryID: jest.fn(() => 1),
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
  initLocale: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const _Zotero = (globalThis as any).Zotero;
_Zotero.Notifier = {
  trigger: jest.fn<(...args: any[]) => Promise<void>>(async () => undefined),
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { toggleNonDuplicates } from "../src/features/nonDuplicates/nonDuplicateActions";
import { hydrateLibrary } from "../src/features/nonDuplicates/hydration";
import { whenItemsDeleted } from "../src/features/nonDuplicates/notifyHandlers";
import {
  NonDuplicateSyncStore,
  SETTING_KEY,
} from "../src/integrations/zotero/syncedSettingsStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Use the real Zotero.SyncedSettings mock from globals.ts as a backing store
 * and create a real NonDuplicateSyncStore instance that reads/writes to it.
 */
function resetSyncedSettings() {
  (_Zotero.SyncedSettings._store as Map<string, any>).clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync integration: full flow", () => {
  const syncStore = new NonDuplicateSyncStore();

  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncedSettings();

    // Setup item resolution
    const getItemMock = _Zotero.Items.get as jest.Mock<any>;
    getItemMock.mockImplementation((input: any) => {
      if (Array.isArray(input)) {
        return input.map((id: number) => ({ id, libraryID: 1, key: `KEY${id}` }));
      }
      return { id: input, libraryID: 1, key: `KEY${input}` };
    });

    (_Zotero.Items.getByLibraryAndKeyAsync as jest.Mock<any>).mockImplementation(
      async (_libraryID: number, key: string) => {
        const match = key.match(/^KEY(\d+)$/);
        if (!match) return false;
        const id = parseInt(match[1], 10);
        return { id, key };
      },
    );
  });

  test("mark writes to both local DB and SyncedSettings", async () => {
    await toggleNonDuplicates("mark", [10, 20], 1, { syncStore });

    // Local DB write
    expect(insertNonDuplicatesMock).toHaveBeenCalledWith([10, 20], 1);

    // SyncedSettings write
    const pairs = syncStore.read(1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual(["KEY10", "KEY20"]);
  });

  test("mark multiple items creates all pair combinations in SyncedSettings", async () => {
    await toggleNonDuplicates("mark", [10, 20, 30], 1, { syncStore });

    const pairs = syncStore.read(1);
    expect(pairs).toHaveLength(3);
    // All 3 combinations: (10,20), (10,30), (20,30)
    const pairStrings = pairs.map(([a, b]: [string, string]) => `${a}-${b}`);
    expect(pairStrings).toContain("KEY10-KEY20");
    expect(pairStrings).toContain("KEY10-KEY30");
    expect(pairStrings).toContain("KEY20-KEY30");
  });

  test("unmark removes from both local DB and SyncedSettings", async () => {
    // First mark
    await toggleNonDuplicates("mark", [10, 20], 1, { syncStore });
    expect(syncStore.read(1)).toHaveLength(1);

    // Then unmark
    await toggleNonDuplicates("unmark", [10, 20], 1, { syncStore });

    expect(deleteNonDuplicatesMock).toHaveBeenCalledWith([10, 20]);
    expect(syncStore.read(1)).toHaveLength(0);
  });

  test("hydrate imports remote-only pairs to local DB", async () => {
    // Simulate remote pairs already in SyncedSettings
    await syncStore.write(1, [["KEY10", "KEY20"], ["KEY30", "KEY40"]]);

    // Local DB has no pairs
    getNonDuplicateKeysMock.mockResolvedValue([]);

    const mockDb = {
      getNonDuplicateKeys: getNonDuplicateKeysMock,
      insertNonDuplicatePair: insertNonDuplicatePairMock,
    } as any;

    await hydrateLibrary(1, mockDb, syncStore);

    expect(insertNonDuplicatePairMock).toHaveBeenCalledWith(10, 20, 1);
    expect(insertNonDuplicatePairMock).toHaveBeenCalledWith(30, 40, 1);
  });

  test("hydrate bootstraps local-only pairs to SyncedSettings", async () => {
    // No remote pairs
    resetSyncedSettings();

    // Local DB has pairs
    getNonDuplicateKeysMock.mockResolvedValue([
      { key1: "KEY10", key2: "KEY20" },
    ]);

    const mockDb = {
      getNonDuplicateKeys: getNonDuplicateKeysMock,
      insertNonDuplicatePair: insertNonDuplicatePairMock,
    } as any;

    await hydrateLibrary(1, mockDb, syncStore);

    // SyncedSettings now has the local pair
    const pairs = syncStore.read(1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual(["KEY10", "KEY20"]);
  });

  test("item deletion cleans up both stores via whenItemsDeleted", async () => {
    // Pre-populate SyncedSettings
    await syncStore.write(1, [["KEY10", "KEY20"], ["KEY30", "KEY40"]]);

    // Mock getKeysForItems to return keys for the deleted item
    getKeysForItemsMock.mockResolvedValue([
      { key: "KEY10", libraryID: 1 },
    ]);

    await whenItemsDeleted([10]);

    // Local DB cleanup
    expect(deleteRecordsMock).toHaveBeenCalledWith(10);

    // SyncedSettings cleanup: pair containing KEY10 should be removed
    const remaining = syncStore.read(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toEqual(["KEY30", "KEY40"]);
  });
});
