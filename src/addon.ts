import { ColumnOptions } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { Action } from "./utils/prefs";

class Addon {
  public data: {
    alive: boolean;
    // Env type, see build.mjs
    env: "development" | "production";
    database: "SQLite" | "IndexedDB";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns?: Array<ColumnOptions>;
      rows?: Array<{ [dataKey: string]: string }>;
    };
    dialogs: {
      dialog?: DialogHelper;
      duplicateMaps?: Map<number, { existingItemIDs: number[]; action: Action }>;
    };
    needResetDuplicateSearch: { [libraryID: number]: boolean };
    duplicateSearchObj: { [libraryID: number]: Zotero.Search };
    duplicateCounts: { [libraryID: number]: { total: number; unique: number } };
    duplicateSets: { [libraryID: number]: typeof Zotero.DisjointSetForest };
    nonDuplicateSectionID: string | false;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      database: "SQLite",
      ztoolkit: createZToolkit(),
      dialogs: {},
      needResetDuplicateSearch: {},
      duplicateSearchObj: {},
      duplicateCounts: {},
      duplicateSets: {},
      nonDuplicateSectionID: false,
    };
    this.hooks = hooks;
    this.api = {};
  }

  public reset() {
    // TODO: To be implemented
    this.data = {
      alive: true,
      env: __env__,
      database: "SQLite",
      ztoolkit: createZToolkit(),
      dialogs: {},
      needResetDuplicateSearch: {},
      duplicateSearchObj: {},
      duplicateCounts: {},
      duplicateSets: {},
      nonDuplicateSectionID: false,
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
