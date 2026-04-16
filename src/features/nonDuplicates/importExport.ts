import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { getString } from "../../shared/locale";
import { fetchDuplicates } from "../../integrations/zotero/duplicateSearch";

// ---------------------------------------------------------------------------
// Export format types
// ---------------------------------------------------------------------------

export interface ExportLibraryEntry {
  libraryType: "user" | "group";
  groupID: number | null;
  libraryName: string;
  pairs: { key1: string; key2: string }[];
}

export interface ExportData {
  format: "zoplicate-nonduplicates";
  version: 1;
  exportedAt: string;
  libraries: ExportLibraryEntry[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  librariesNotFound: string[];
}

// ---------------------------------------------------------------------------
// Library ID helpers
// ---------------------------------------------------------------------------

function getPortableLibraryInfo(libraryID: number): {
  libraryType: "user" | "group";
  groupID: number | null;
  libraryName: string;
} | null {
  const lib = Zotero.Libraries.get(libraryID);
  if (!lib) return null;

  if (lib.libraryType === "user") {
    return { libraryType: "user", groupID: null, libraryName: lib.name };
  }
  if (lib.libraryType === "group") {
    const groupID = Zotero.Groups.getGroupIDFromLibraryID(libraryID);
    return { libraryType: "group", groupID, libraryName: lib.name };
  }
  return null;
}

function resolveLibraryID(entry: {
  libraryType: string;
  groupID: number | null;
}): number | null {
  if (entry.libraryType === "user") {
    return Zotero.Libraries.userLibraryID;
  }
  if (entry.libraryType === "group" && entry.groupID != null) {
    const allLibs = Zotero.Libraries.getAll();
    for (const lib of allLibs) {
      if (lib.libraryType === "group") {
        const gid = Zotero.Groups.getGroupIDFromLibraryID(lib.libraryID);
        if (gid === entry.groupID) {
          return lib.libraryID;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function buildExportData(): Promise<ExportData> {
  const db = NonDuplicatesDB.instance;
  const allLibraries = Zotero.Libraries.getAll();
  const libraries: ExportLibraryEntry[] = [];

  for (const lib of allLibraries) {
    if (lib.libraryType === "feed") continue;

    const info = getPortableLibraryInfo(lib.libraryID);
    if (!info) continue;

    const keyPairs = await db.getNonDuplicateKeys({ libraryID: lib.libraryID });
    if (keyPairs.length === 0) continue;

    // Normalize ordering: key1 < key2
    const normalizedPairs = keyPairs.map(({ key1, key2 }) =>
      key1 < key2 ? { key1, key2 } : { key1: key2, key2: key1 },
    );

    libraries.push({
      libraryType: info.libraryType,
      groupID: info.groupID,
      libraryName: info.libraryName,
      pairs: normalizedPairs,
    });
  }

  return {
    format: "zoplicate-nonduplicates",
    version: 1,
    exportedAt: new Date().toISOString(),
    libraries,
  };
}

export function getTotalPairCount(data: ExportData): number {
  return data.libraries.reduce((sum, lib) => sum + lib.pairs.length, 0);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function validateExportData(data: unknown): data is ExportData {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.format === "zoplicate-nonduplicates" &&
    obj.version === 1 &&
    Array.isArray(obj.libraries)
  );
}

export async function importFromData(data: unknown): Promise<ImportResult> {
  if (!validateExportData(data)) {
    return { imported: 0, skipped: 0, librariesNotFound: [] };
  }

  const db = NonDuplicatesDB.instance;
  let imported = 0;
  let skipped = 0;
  const librariesNotFound: string[] = [];
  const refreshLibraries = new Set<number>();

  for (const entry of data.libraries) {
    const libraryID = resolveLibraryID(entry);
    if (libraryID == null) {
      librariesNotFound.push(entry.libraryName || `${entry.libraryType}:${entry.groupID ?? "user"}`);
      skipped += entry.pairs.length;
      continue;
    }

    for (const pair of entry.pairs) {
      if (!pair.key1 || !pair.key2) {
        skipped++;
        continue;
      }

      const item1 = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, pair.key1);
      const item2 = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, pair.key2);

      if (!item1 || !item2) {
        skipped++;
        continue;
      }

      const exists = await db.existsNonDuplicatePair(item1.id, item2.id);
      if (exists) {
        skipped++;
        continue;
      }

      await db.insertNonDuplicatePair(item1.id, item2.id, libraryID);
      imported++;
      refreshLibraries.add(libraryID);
    }
  }

  // Refresh duplicate views for affected libraries
  for (const libraryID of refreshLibraries) {
    await fetchDuplicates({ libraryID, refresh: true });
  }

  return { imported, skipped, librariesNotFound };
}

// ---------------------------------------------------------------------------
// File I/O via FilePicker
// ---------------------------------------------------------------------------

export async function exportToFile(win: Window): Promise<void> {
  const data = await buildExportData();
  const totalPairs = getTotalPairCount(data);

  if (totalPairs === 0) {
    Zotero.alert(win, "Zoplicate", getString("data-export-empty"));
    return;
  }

  const { FilePicker } = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  );
  const fp = new FilePicker();
  fp.init(win, getString("data-export-title"), fp.modeSave);
  fp.defaultString = "zoplicate-nonduplicates.json";
  fp.appendFilter("JSON", "*.json");

  const result = await fp.show();
  if (result !== fp.returnOK && result !== fp.returnReplace) {
    return;
  }

  const json = JSON.stringify(data, null, 2);
  await Zotero.File.putContentsAsync(fp.file, json);

  Zotero.alert(
    win,
    "Zoplicate",
    getString("data-export-success", { args: { count: totalPairs } }),
  );
}

export async function importFromFile(win: Window): Promise<void> {
  const { FilePicker } = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  );
  const fp = new FilePicker();
  fp.init(win, getString("data-import-title"), fp.modeOpen);
  fp.appendFilter("JSON", "*.json");

  const result = await fp.show();
  if (result !== fp.returnOK) {
    return;
  }

  let data: unknown;
  try {
    const contents = await Zotero.File.getContentsAsync(fp.file);
    data = JSON.parse(contents as string);
  } catch {
    Zotero.alert(win, "Zoplicate", getString("data-import-no-data"));
    return;
  }

  if (!validateExportData(data)) {
    Zotero.alert(win, "Zoplicate", getString("data-import-no-data"));
    return;
  }

  const importResult = await importFromData(data);

  let message = getString("data-import-success", {
    args: { imported: importResult.imported, skipped: importResult.skipped },
  });

  if (importResult.librariesNotFound.length > 0) {
    message +=
      "\n" +
      getString("data-import-libraries-not-found", {
        args: { libraries: importResult.librariesNotFound.join(", ") },
      });
  }

  Zotero.alert(win, "Zoplicate", message);
}
