import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  NonDuplicateSyncStore,
  SETTING_KEY,
  normalizePair,
  dedupPairs,
} from "../src/integrations/zotero/syncedSettingsStore";

const _Zotero = (globalThis as any).Zotero;
const ssStore: Map<string, any> = _Zotero.SyncedSettings._store;

let store: NonDuplicateSyncStore;

beforeEach(() => {
  ssStore.clear();
  jest.clearAllMocks();
  store = new NonDuplicateSyncStore();
});

// ---------------------------------------------------------------------------
// T1: Round-trip write-read
// ---------------------------------------------------------------------------

describe("round-trip write-read", () => {
  test("T1: written pairs can be read back", async () => {
    const pairs: [string, string][] = [["ABC", "DEF"], ["GHI", "JKL"]];
    await store.write(1, pairs);
    const result = store.read(1);
    expect(result).toEqual([["ABC", "DEF"], ["GHI", "JKL"]]);
  });
});

// ---------------------------------------------------------------------------
// T2: normalizePair sorts lexicographically
// ---------------------------------------------------------------------------

describe("normalizePair", () => {
  test("T2: sorts keys lexicographically", () => {
    expect(normalizePair("ZZZ", "AAA")).toEqual(["AAA", "ZZZ"]);
    expect(normalizePair("AAA", "ZZZ")).toEqual(["AAA", "ZZZ"]);
    expect(normalizePair("ABC", "ABC")).toEqual(["ABC", "ABC"]);
  });
});

// ---------------------------------------------------------------------------
// T3: write deduplicates pairs (including reversed)
// ---------------------------------------------------------------------------

describe("write deduplication", () => {
  test("T3: duplicate and reversed pairs are collapsed", async () => {
    const pairs: [string, string][] = [
      ["A", "B"],
      ["B", "A"],  // reversed duplicate
      ["A", "B"],  // exact duplicate
      ["C", "D"],
    ];
    await store.write(1, pairs);
    const result = store.read(1);
    expect(result).toEqual([["A", "B"], ["C", "D"]]);
  });
});

// ---------------------------------------------------------------------------
// T4: addPair adds new pair without duplicating
// ---------------------------------------------------------------------------

describe("addPair", () => {
  test("T4: adds a new pair", async () => {
    await store.addPair(1, "K1", "K2");
    const result = store.read(1);
    expect(result).toEqual([["K1", "K2"]]);
  });

  // T5: addPair with existing pair is no-op
  test("T5: existing pair is not duplicated", async () => {
    await store.addPair(1, "K1", "K2");
    await store.addPair(1, "K2", "K1"); // reversed order
    const result = store.read(1);
    expect(result).toEqual([["K1", "K2"]]);
    // set() should only have been called once (the first addPair)
    expect(_Zotero.SyncedSettings.set).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T6: removePair removes specified pair regardless of key order
// ---------------------------------------------------------------------------

describe("removePair", () => {
  test("T6: removes pair regardless of argument order", async () => {
    await store.write(1, [["A", "B"], ["C", "D"]]);
    jest.clearAllMocks();
    await store.removePair(1, "B", "A"); // reversed order
    const result = store.read(1);
    expect(result).toEqual([["C", "D"]]);
  });

  // T7: removePair on non-existent pair is no-op
  test("T7: non-existent pair removal is no-op", async () => {
    await store.write(1, [["A", "B"]]);
    jest.clearAllMocks();
    await store.removePair(1, "X", "Y");
    // set() should not be called since nothing changed
    expect(_Zotero.SyncedSettings.set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T8: read with v:2 (unknown version) returns empty + warns
// ---------------------------------------------------------------------------

describe("version validation", () => {
  test("T8: unknown version returns empty array and logs warning", () => {
    const key = `1/${SETTING_KEY}`;
    ssStore.set(key, { v: 2, pairs: [["A", "B"]] });
    const result = store.read(1);
    expect(result).toEqual([]);
    expect(_Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("unknown payload version"),
    );
  });
});

// ---------------------------------------------------------------------------
// T9: read when setting missing returns empty
// ---------------------------------------------------------------------------

describe("missing setting", () => {
  test("T9: returns empty array when setting does not exist", () => {
    const result = store.read(1);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T10: clear removes setting
// ---------------------------------------------------------------------------

describe("clear", () => {
  test("T10: clears the setting from SyncedSettings", async () => {
    await store.write(1, [["A", "B"]]);
    await store.clear(1);
    expect(_Zotero.SyncedSettings.clear).toHaveBeenCalledWith(
      1,
      SETTING_KEY,
    );
    const result = store.read(1);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T11: stored pairs always normalized
// ---------------------------------------------------------------------------

describe("normalization on storage", () => {
  test("T11: pairs are always stored in normalized (sorted) order", async () => {
    await store.write(1, [["ZZZ", "AAA"], ["MMM", "BBB"]]);
    // Read the raw stored value to verify normalization
    const raw = ssStore.get(`1/${SETTING_KEY}`);
    expect(raw.pairs).toEqual([["AAA", "ZZZ"], ["BBB", "MMM"]]);
  });
});

// ---------------------------------------------------------------------------
// T12: read when get() throws returns empty + warns (UnloadedDataException)
// ---------------------------------------------------------------------------

describe("error handling", () => {
  test("T12: returns empty array and warns when get() throws", () => {
    (_Zotero.SyncedSettings.get as jest.Mock<any>).mockImplementationOnce(
      () => {
        throw new Error("Zotero.UnloadedDataException: data not loaded");
      },
    );
    const result = store.read(1);
    expect(result).toEqual([]);
    expect(_Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("SyncedSettings.get() threw"),
    );
  });
});

// ---------------------------------------------------------------------------
// dedupPairs unit test
// ---------------------------------------------------------------------------

describe("dedupPairs", () => {
  test("deduplicates and normalizes an array of pairs", () => {
    const input: [string, string][] = [
      ["B", "A"],
      ["A", "B"],
      ["C", "D"],
      ["D", "C"],
      ["E", "F"],
    ];
    const result = dedupPairs(input);
    expect(result).toEqual([["A", "B"], ["C", "D"], ["E", "F"]]);
  });
});
