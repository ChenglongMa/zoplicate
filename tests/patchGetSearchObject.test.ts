import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { patchGetSearchObject } from "../src/integrations/zotero/patches/patchGetSearchObject";
import type { Disposer } from "../src/app/lifecycle";

const _Zotero = (globalThis as any).Zotero;
const _addon = (globalThis as any).addon;

function makeSearch(tmpTable: string, searchResultIDs: number[] = []) {
  return {
    getConditions: jest.fn(() => ({
      1: {
        condition: "tempTable",
        operator: "is",
        value: tmpTable,
      },
    })),
    search: jest.fn(async () => searchResultIDs),
  };
}

describe("patchGetSearchObject temp table validation", () => {
  let dispose: Disposer | undefined;
  let originalGetSearchObject: any;
  let refreshDuplicateStats: any;
  let refreshedSearch: ReturnType<typeof makeSearch>;
  let refreshedSets: any;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = undefined;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    _addon.data.needResetDuplicateSearch = {};
    _addon.data.duplicateSearchObj = {};
    _addon.data.duplicateSets = {};
    _addon.data.duplicateCounts = {};

    refreshedSearch = makeSearch("tmpDuplicates_refreshed", [101, 102]);
    refreshedSets = { refreshed: true };
    originalGetSearchObject = jest.fn(async function (this: any) {
      this._sets = refreshedSets;
      return refreshedSearch;
    });
    refreshDuplicateStats = jest.fn(async () => undefined);

    class DuplicatesMock {
      _libraryID: number;
      _sets: any = undefined;

      constructor(libraryID: number) {
        this._libraryID = libraryID;
      }

      async getSearchObject() {
        return originalGetSearchObject.call(this);
      }
    }

    _Zotero.Duplicates = DuplicatesMock;
    _Zotero.DB = {
      valueQueryAsync: jest.fn(async () => 1),
    };
  });

  test("reuses a cached duplicate search when its temp table still exists", async () => {
    const cachedSearch = makeSearch("tmpDuplicates_live", [1, 2]);
    const cachedSets = { cached: true };
    _addon.data.duplicateSearchObj[7] = cachedSearch;
    _addon.data.duplicateSets[7] = cachedSets;
    _addon.data.needResetDuplicateSearch[7] = false;
    _Zotero.DB.valueQueryAsync.mockResolvedValue(1);

    dispose = patchGetSearchObject(refreshDuplicateStats);
    const duplicatesObj = new _Zotero.Duplicates(7);
    const search = await duplicatesObj.getSearchObject();

    expect(search).toBe(cachedSearch);
    expect(_Zotero.DB.valueQueryAsync).toHaveBeenCalledWith(
      "SELECT COUNT(*) FROM sqlite_temp_master WHERE type='table' AND name=?",
      ["tmpDuplicates_live"],
    );
    expect(originalGetSearchObject).not.toHaveBeenCalled();
    expect(refreshDuplicateStats).not.toHaveBeenCalled();
    expect(duplicatesObj._sets).toBe(cachedSets);
  });

  test("rebuilds a cached duplicate search when its temp table was dropped", async () => {
    const cachedSearch = makeSearch("tmpDuplicates_dropped", [1, 2]);
    _addon.data.duplicateSearchObj[7] = cachedSearch;
    _addon.data.duplicateSets[7] = { cached: true };
    _addon.data.needResetDuplicateSearch[7] = false;
    _Zotero.DB.valueQueryAsync.mockResolvedValue(0);

    dispose = patchGetSearchObject(refreshDuplicateStats);
    const duplicatesObj = new _Zotero.Duplicates(7);
    const search = await duplicatesObj.getSearchObject();

    expect(search).toBe(refreshedSearch);
    expect(originalGetSearchObject).toHaveBeenCalledTimes(1);
    expect(refreshedSearch.search).toHaveBeenCalledTimes(1);
    expect(refreshDuplicateStats).toHaveBeenCalledWith(7, duplicatesObj, [101, 102]);
    expect(_addon.data.duplicateSearchObj[7]).toBe(refreshedSearch);
    expect(_addon.data.duplicateSets[7]).toBe(refreshedSets);
    expect(_addon.data.needResetDuplicateSearch[7]).toBe(false);
    expect(duplicatesObj._sets).toBe(refreshedSets);
  });

  test("rebuilds a cached duplicate search when temp table validation fails", async () => {
    const cachedSearch = makeSearch("tmpDuplicates_unknown", [1, 2]);
    const error = new Error("database connection reopened");
    _addon.data.duplicateSearchObj[7] = cachedSearch;
    _addon.data.duplicateSets[7] = { cached: true };
    _addon.data.needResetDuplicateSearch[7] = false;
    _Zotero.DB.valueQueryAsync.mockRejectedValue(error);

    dispose = patchGetSearchObject(refreshDuplicateStats);
    const duplicatesObj = new _Zotero.Duplicates(7);
    const search = await duplicatesObj.getSearchObject();

    expect(search).toBe(refreshedSearch);
    expect(originalGetSearchObject).toHaveBeenCalledTimes(1);
    expect(refreshDuplicateStats).toHaveBeenCalledWith(7, duplicatesObj, [101, 102]);
    expect(ztoolkit.log).toHaveBeenCalledWith(
      "Zoplicate: error checking temp table, rebuilding duplicate search:",
      error,
    );
  });
});
