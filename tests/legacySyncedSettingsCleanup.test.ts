import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanupLegacyNonDuplicateSyncedSettings,
  LEGACY_NON_DUPLICATE_SYNC_SETTING,
} from "../src/features/nonDuplicates/legacySyncedSettingsCleanup";

const _Zotero = (globalThis as any).Zotero;

beforeEach(() => {
  jest.clearAllMocks();
  _Zotero.Libraries.getAll.mockReturnValue([
    { libraryID: 1, libraryType: "user" },
    { libraryID: 2, libraryType: "group" },
    { libraryID: 3, libraryType: "feed" },
  ]);
});

describe("cleanupLegacyNonDuplicateSyncedSettings", () => {
  test("clears the legacy setting from user and group libraries", async () => {
    await cleanupLegacyNonDuplicateSyncedSettings();

    expect(_Zotero.SyncedSettings.loadAll).toHaveBeenCalledWith(1);
    expect(_Zotero.SyncedSettings.loadAll).toHaveBeenCalledWith(2);
    expect(_Zotero.SyncedSettings.loadAll).not.toHaveBeenCalledWith(3);
    expect(_Zotero.SyncedSettings.clear).toHaveBeenCalledWith(
      1,
      LEGACY_NON_DUPLICATE_SYNC_SETTING,
      { skipDeleteLog: true },
    );
    expect(_Zotero.SyncedSettings.clear).toHaveBeenCalledWith(
      2,
      LEGACY_NON_DUPLICATE_SYNC_SETTING,
      { skipDeleteLog: true },
    );
  });

  test("treats a missing legacy setting as a successful cleanup", async () => {
    _Zotero.SyncedSettings.clear.mockResolvedValueOnce(false);

    await expect(cleanupLegacyNonDuplicateSyncedSettings()).resolves.toBeUndefined();
  });

  test("logs one library failure and continues cleaning other libraries", async () => {
    _Zotero.SyncedSettings.clear
      .mockRejectedValueOnce(new Error("clear failed"))
      .mockResolvedValueOnce(true);

    await cleanupLegacyNonDuplicateSyncedSettings();

    expect(_Zotero.SyncedSettings.clear).toHaveBeenCalledTimes(2);
    expect(_Zotero.SyncedSettings.clear).toHaveBeenNthCalledWith(
      2,
      2,
      LEGACY_NON_DUPLICATE_SYNC_SETTING,
      { skipDeleteLog: true },
    );
    expect(_Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("legacy SyncedSettings cleanup failed for library 1"),
    );
  });

  test("logs and exits when libraries cannot be enumerated", async () => {
    _Zotero.Libraries.getAll.mockImplementationOnce(() => {
      throw new Error("libraries failed");
    });

    await cleanupLegacyNonDuplicateSyncedSettings();

    expect(_Zotero.SyncedSettings.clear).not.toHaveBeenCalled();
    expect(_Zotero.debug).toHaveBeenCalledWith(
      expect.stringContaining("legacy SyncedSettings cleanup failed"),
    );
  });
});
