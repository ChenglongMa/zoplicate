import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { patchFindDuplicates } from "../src/integrations/zotero/patches/patchFindDuplicates";

const _Zotero = (globalThis as any).Zotero;

function installDuplicateRuntime(edges: Array<[number, number]>) {
  const unions: Array<[number, number]> = [];

  class FakeDisjointSetForest {
    union(x: { id: number }, y: { id: number }) {
      unions.push([x.id, y.id]);
    }
  }

  class FakeDuplicates {
    public libraryID: number;

    constructor(libraryID: number) {
      this.libraryID = libraryID;
    }

    async _findDuplicates() {
      const forest = new _Zotero.DisjointSetForest();
      for (const [x, y] of edges) {
        forest.union({ id: x }, { id: y });
      }
    }
  }

  _Zotero.DisjointSetForest = FakeDisjointSetForest;
  _Zotero.Duplicates = FakeDuplicates;
  return unions;
}

function rowsFromPairs(pairs: Set<string>) {
  return [...pairs].map((pair) => {
    const [itemID, itemID2] = pair.split(",").map(Number);
    return { itemID, itemID2 };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("patchFindDuplicates non-duplicate cross flow", () => {
  test("marked non-duplicate pairs are excluded, and unmarking allows them again", async () => {
    const markedPairs = new Set(["1,2"]);
    const unions = installDuplicateRuntime([[1, 2]]);
    const db = {
      getNonDuplicates: jest.fn<(...args: any[]) => Promise<any[]>>(async () => rowsFromPairs(markedPairs)),
    };
    const nonDuplicateState = { allNonDuplicates: new Set<string>() };
    const disposer = patchFindDuplicates(db as any, () => nonDuplicateState);

    await new _Zotero.Duplicates(7)._findDuplicates();
    expect(db.getNonDuplicates).toHaveBeenCalledWith({ libraryID: 7 });
    expect(unions).toEqual([]);

    markedPairs.clear();
    await new _Zotero.Duplicates(7)._findDuplicates();
    expect(unions).toEqual([[1, 2]]);

    await disposer();
  });

  test("a marked existing pair does not block a newly imported third item from linking to allowed duplicates", async () => {
    const markedPairs = new Set(["1,2"]);
    const unions = installDuplicateRuntime([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    const db = {
      getNonDuplicates: jest.fn<(...args: any[]) => Promise<any[]>>(async () => rowsFromPairs(markedPairs)),
    };
    const nonDuplicateState = { allNonDuplicates: new Set<string>() };
    const disposer = patchFindDuplicates(db as any, () => nonDuplicateState);

    await new _Zotero.Duplicates(7)._findDuplicates();

    expect(unions).toEqual([
      [1, 3],
      [2, 3],
    ]);

    await disposer();
  });

  test("disposer restores Zotero duplicate and union methods", async () => {
    installDuplicateRuntime([[1, 2]]);
    const originalFindDuplicates = _Zotero.Duplicates.prototype._findDuplicates;
    const originalUnion = _Zotero.DisjointSetForest.prototype.union;
    const disposer = patchFindDuplicates({ getNonDuplicates: jest.fn(async () => []) } as any, () => ({
      allNonDuplicates: new Set<string>(),
    }));

    expect(_Zotero.Duplicates.prototype._findDuplicates).not.toBe(originalFindDuplicates);
    expect(_Zotero.DisjointSetForest.prototype.union).not.toBe(originalUnion);

    await disposer();

    expect(_Zotero.Duplicates.prototype._findDuplicates).toBe(originalFindDuplicates);
    expect(_Zotero.DisjointSetForest.prototype.union).toBe(originalUnion);
  });

  test("when mergeDifferentTypes is enabled, detects items sharing same ISBN across types", async () => {
    (_Zotero.Prefs.get as jest.Mock<any>).mockImplementation((key: string) => {
      if (key.includes("duplicate.merge.differentTypes")) return true;
      return false;
    });

    const unions = installDuplicateRuntime([]);
    _Zotero.DB = {
      queryAsync: jest.fn(async () => [
        { itemID: 10, value: "978-3-16-148410-0" },
        { itemID: 20, value: "9783161484100" },
      ]),
    };

    const disposer = patchFindDuplicates({ getNonDuplicates: jest.fn(async () => []) } as any, () => ({
      allNonDuplicates: new Set<string>(),
    }));

    const dup = new _Zotero.Duplicates(1);
    (dup as any)._sets = new _Zotero.DisjointSetForest();
    await dup._findDuplicates();

    expect(unions).toContainEqual([10, 20]);

    await disposer();
  });
});
