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
  function createScheduledHandler(getLoadedWindows: () => Window[] = () => []) {
    let flush: (() => Promise<void>) | undefined;
    const handler = createDuplicatesNotifyHandler(() => false, getLoadedWindows, {
      schedulePendingAddFlush: (callback) => {
        flush = callback;
      },
    });

    return {
      handler,
      flush: async () => {
        expect(flush).toBeDefined();
        await flush!();
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    _Zotero.Items.get = jest.fn(() => ({
      libraryID: 1,
      deleted: false,
      isRegularItem: jest.fn(() => true),
    }));
    _Zotero.ItemTreeManager = { refreshColumns: jest.fn() };
    delete _Zotero.Sync;
    delete _Zotero.DB;
    fetchDuplicatesMock.mockResolvedValue({ duplicatesObj: { getSetItemsByItemID: jest.fn(() => [10, 20]) } });
  });

  test("passes the first live loaded window to duplicate import handling", async () => {
    const liveWin = { closed: false, ZoteroPane: { getCollectionTreeRow: jest.fn() } } as any;
    const { handler, flush } = createScheduledHandler(() => [{ closed: true } as any, liveWin]);

    await handler("add", "item", [10], {});

    expect(fetchDuplicatesMock).not.toHaveBeenCalled();
    expect(whenItemsAddedMock).not.toHaveBeenCalled();

    await flush();

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).toHaveBeenCalledWith(expect.anything(), [10], { win: liveWin });
  });

  test("calls fetchDuplicates when modify event has per-item keyed refreshDuplicates", async () => {
    const handler = createDuplicatesNotifyHandler(
      () => false,
      () => [],
    );

    await handler("modify", "item", [78898], { 78898: { refreshDuplicates: true } });

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
  });

  test("does not auto-process item additions while Zotero sync is running", async () => {
    const { handler } = createScheduledHandler();

    await handler("start", "sync", [], {});
    await handler("add", "item", [10], { 10: { skipSelect: true, skipRenameFile: true } });

    expect(fetchDuplicatesMock).not.toHaveBeenCalled();
    expect(whenItemsAddedMock).not.toHaveBeenCalled();

    await handler("finish", "sync", [1], {});

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).not.toHaveBeenCalled();
  });

  test("refreshes but does not auto-process sync-saved items identified by notifier data", async () => {
    const { handler } = createScheduledHandler();

    await handler("add", "item", [10], { 10: { skipSelect: true, skipRenameFile: true } });

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).not.toHaveBeenCalled();
  });

  test("waits until the scheduled flush to inspect added items", async () => {
    let itemType = "book";
    _Zotero.Items.get = jest.fn(() => ({
      libraryID: 1,
      deleted: false,
      itemType,
      isRegularItem: jest.fn(() => true),
    }));
    const { handler, flush } = createScheduledHandler();

    await handler("add", "item", [10], {});
    itemType = "bookSection";
    await flush();

    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).toHaveBeenCalledWith(expect.anything(), [10], expect.anything());
  });

  test("waits for Zotero save transactions before processing queued additions", async () => {
    let inTransaction = true;
    _Zotero.DB = {
      inTransaction: jest.fn(() => inTransaction),
      waitForTransaction: jest.fn(async () => {
        inTransaction = false;
      }),
    };
    const { handler, flush } = createScheduledHandler();

    await handler("add", "item", [10], {});
    await flush();

    expect(_Zotero.DB.waitForTransaction).toHaveBeenCalledWith("zoplicate duplicate add");
    expect(fetchDuplicatesMock).toHaveBeenCalledWith({ libraryID: 1, refresh: true });
    expect(whenItemsAddedMock).toHaveBeenCalledWith(expect.anything(), [10], expect.anything());
  });

  test("skips closed windows when refreshing duplicate pane UI", async () => {
    const liveWin = {
      closed: false,
      ZoteroPane: {
        getCollectionTreeRow: jest.fn(() => ({ isDuplicates: () => true })),
      },
    } as any;
    const handler = createDuplicatesNotifyHandler(
      () => false,
      () => [{ closed: true } as any, liveWin],
    );

    await handler("removeDuplicatesMaster", "item", [10], {});

    expect(_Zotero.ItemTreeManager.refreshColumns).toHaveBeenCalledTimes(1);
  });
});
