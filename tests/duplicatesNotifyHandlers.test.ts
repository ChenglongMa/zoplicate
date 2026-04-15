import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchDuplicatesMock = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  fetchDuplicates: fetchDuplicatesMock,
}));

const containsRegularItemMock = jest.fn(() => true);
jest.mock("../src/shared/items", () => ({
  containsRegularItem: containsRegularItemMock,
}));

const whenItemsAddedMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
jest.mock("../src/features/duplicates/duplicates", () => ({
  Duplicates: {
    instance: {
      whenItemsAdded: whenItemsAddedMock,
    },
  },
}));

import { createDuplicatesNotifyHandler } from "../src/features/duplicates/notifyHandlers";

const _Zotero = (globalThis as any).Zotero;

describe("createDuplicatesNotifyHandler window selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _Zotero.Items.get = jest.fn(() => ({ libraryID: 1 }));
    _Zotero.ItemTreeManager = { refreshColumns: jest.fn() };
    fetchDuplicatesMock.mockResolvedValue({ duplicatesObj: { getSetItemsByItemID: jest.fn(() => [10, 20]) } });
  });

  test("passes the first live loaded window to duplicate import handling", async () => {
    const liveWin = { closed: false, ZoteroPane: { getCollectionTreeRow: jest.fn() } } as any;
    const handler = createDuplicatesNotifyHandler(() => false, () => [{ closed: true } as any, liveWin]);

    await handler("add", "item", [10], {});

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).toHaveBeenCalledWith(expect.anything(), [10], { win: liveWin });
  });

  test("skips closed windows when refreshing duplicate pane UI", async () => {
    const liveWin = {
      closed: false,
      ZoteroPane: {
        getCollectionTreeRow: jest.fn(() => ({ isDuplicates: () => true })),
      },
    } as any;
    const handler = createDuplicatesNotifyHandler(() => false, () => [{ closed: true } as any, liveWin]);

    await handler("removeDuplicatesMaster", "item", [10], {});

    expect(_Zotero.ItemTreeManager.refreshColumns).toHaveBeenCalledTimes(1);
  });
});
