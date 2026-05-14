import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const findMock = jest.fn<() => Promise<any[]>>();
jest.mock("../src/db/duplicateFinder", () => ({
  DuplicateFinder: jest.fn().mockImplementation(() => ({ find: findMock })),
}));

jest.mock("../src/shared/duplicates/duplicateItems", () => ({
  DuplicateItems: jest.fn(),
}));

jest.mock("../src/shared/prefs", () => ({
  getPref: jest.fn(),
  MasterItem: {},
}));

import { patchItemSaveData } from "../src/integrations/zotero/patches/patchItemSaveData";

const _Zotero = (globalThis as any).Zotero;

describe("patchItemSaveData", () => {
  let originalSaveData: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    originalSaveData = jest.fn(async () => {});
    _Zotero.Item = { prototype: { _saveData: originalSaveData } };
    _Zotero.Items.get = jest.fn(() => ({ deleted: false }));
    _Zotero.Notifier.queue = jest.fn();
    findMock.mockResolvedValue([]);
  });

  function callPatched(ctx: Record<string, any>, env: Record<string, any>) {
    return _Zotero.Item.prototype._saveData.call(ctx, env);
  }

  function makeCtx(overrides: Record<string, any> = {}) {
    return {
      parentID: null,
      _changed: {},
      isRegularItem: () => true,
      id: 100,
      ...overrides,
    };
  }

  function makeEnv(overrides: Record<string, any> = {}): any {
    return {
      isNew: false,
      options: { skipNotifier: false, notifierQueue: undefined },
      notifierData: {},
      ...overrides,
    };
  }

  test("annotates notifierData when creators changed on regular item", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv();
    const ctx = makeCtx({ _changed: { creators: { 0: true } } });

    await callPatched(ctx, env);

    expect(env.notifierData).toEqual(expect.objectContaining({ refreshDuplicates: true }));
    expect(originalSaveData).toHaveBeenCalledWith(env);

    disposer();
  });

  test("annotates notifierData when itemData changed on regular item", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv();
    const ctx = makeCtx({ _changed: { itemData: { 1: true } } });

    await callPatched(ctx, env);

    expect(env.notifierData).toEqual(expect.objectContaining({ refreshDuplicates: true }));

    disposer();
  });

  test("does NOT annotate for new items", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv({ isNew: true });
    const ctx = makeCtx({ _changed: { creators: { 0: true } } });

    await callPatched(ctx, env);

    expect(env.notifierData.refreshDuplicates).toBeUndefined();

    disposer();
  });

  test("does NOT annotate when skipNotifier is true", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv({ options: { skipNotifier: true } });
    const ctx = makeCtx({ _changed: { creators: { 0: true } } });

    await callPatched(ctx, env);

    expect(env.notifierData.refreshDuplicates).toBeUndefined();

    disposer();
  });

  test("does NOT annotate for non-regular items", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv();
    const ctx = makeCtx({
      _changed: { creators: { 0: true } },
      isRegularItem: () => false,
    });

    await callPatched(ctx, env);

    expect(env.notifierData.refreshDuplicates).toBeUndefined();

    disposer();
  });

  test("does NOT annotate when neither creators nor itemData changed", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv();
    const ctx = makeCtx({ _changed: { tags: true } });

    await callPatched(ctx, env);

    expect(env.notifierData.refreshDuplicates).toBeUndefined();

    disposer();
  });

  test("never calls Notifier.queue (regression: no extra events)", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv();
    const ctx = makeCtx({ _changed: { creators: { 0: true }, itemData: { 1: true } } });

    await callPatched(ctx, env);

    expect(_Zotero.Notifier.queue).not.toHaveBeenCalled();

    disposer();
  });

  test("creates notifierData if absent", async () => {
    const disposer = patchItemSaveData();
    const env = makeEnv({ notifierData: undefined });
    const ctx = makeCtx({ _changed: { itemData: { 1: true } } });

    await callPatched(ctx, env);

    expect(env.notifierData).toEqual(expect.objectContaining({ refreshDuplicates: true }));

    disposer();
  });
});
