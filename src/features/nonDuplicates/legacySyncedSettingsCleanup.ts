export const LEGACY_NON_DUPLICATE_SYNC_SETTING = "zoplicate-nonDuplicatePairs";

export async function cleanupLegacyNonDuplicateSyncedSettings(): Promise<void> {
  try {
    const allLibraries = Zotero.Libraries.getAll();
    for (const lib of allLibraries) {
      if (lib.libraryType === "feed") continue;

      try {
        await Zotero.SyncedSettings.loadAll(lib.libraryID);
        await Zotero.SyncedSettings.clear(
          lib.libraryID,
          LEGACY_NON_DUPLICATE_SYNC_SETTING,
          { skipDeleteLog: true },
        );
      } catch (err) {
        Zotero.debug(
          `[zoplicate] legacy SyncedSettings cleanup failed for library ${lib.libraryID}: ${err}`,
        );
      }
    }
  } catch (err) {
    Zotero.debug(`[zoplicate] legacy SyncedSettings cleanup failed: ${err}`);
  }
}
