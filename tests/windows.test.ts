import { describe, expect, jest, test } from "@jest/globals";

import { isInDuplicatesPane } from "../src/integrations/zotero/windows";

describe("isInDuplicatesPane", () => {
  test("uses Zotero 10's multi-row API without calling the removed single-row API", () => {
    const removedApi = jest.fn(() => {
      throw new Error("getCollectionTreeRow was removed");
    });
    const win = {
      ZoteroPane: {
        getCollectionTreeRows: jest.fn(() => [{ isDuplicates: () => false }, { isDuplicates: () => true }]),
        getCollectionTreeRow: removedApi,
      },
    } as any;

    expect(isInDuplicatesPane(win)).toBe(true);
    expect(removedApi).not.toHaveBeenCalled();
  });

  test("retains a fallback for older Zotero prerelease builds", () => {
    const win = {
      ZoteroPane: {
        getCollectionTreeRow: jest.fn(() => ({ isDuplicates: () => true })),
      },
    } as any;

    expect(isInDuplicatesPane(win)).toBe(true);
  });

  test("uses the requested collection-tree row when an index is provided", () => {
    const win = {
      ZoteroPane: {
        collectionsView: {
          getRow: jest.fn(() => ({ isDuplicates: () => true })),
        },
        getCollectionTreeRows: jest.fn(() => []),
      },
    } as any;

    expect(isInDuplicatesPane(win, 3)).toBe(true);
    expect(win.ZoteroPane.collectionsView.getRow).toHaveBeenCalledWith(3);
    expect(win.ZoteroPane.getCollectionTreeRows).not.toHaveBeenCalled();
  });
});

describe("getSelectedLibraryID", () => {
  test("uses Zotero 10's plural API without calling the removed singular API", async () => {
    const { getSelectedLibraryID } = await import("../src/integrations/zotero/windows");
    const removedApi = jest.fn(() => {
      throw new Error("getSelectedLibraryID was removed");
    });
    const win = {
      ZoteroPane: {
        getSelectedLibraryIDs: jest.fn(() => [7, 8]),
        getSelectedLibraryID: removedApi,
      },
    } as any;

    expect(getSelectedLibraryID(win)).toBe(7);
    expect(removedApi).not.toHaveBeenCalled();
  });

  test("throws a clear error when Zotero has no selected library", async () => {
    const { getSelectedLibraryID } = await import("../src/integrations/zotero/windows");
    const win = {
      ZoteroPane: {
        getSelectedLibraryIDs: jest.fn(() => []),
      },
    } as any;

    expect(() => getSelectedLibraryID(win)).toThrow("No Zotero library is selected");
  });
});
