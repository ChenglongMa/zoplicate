import { ColumnOptions } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { Action } from "./utils/prefs";
import { PatchHelper } from "zotero-plugin-toolkit/dist/helpers/patch";
import * as punycode from "punycode";

class Addon {
  public data: {
    alive: boolean;
    // Env type, see build.mjs
    env: "development" | "production";
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
    renderItemPatcher?: PatchHelper;
    refreshDuplicateStats: boolean;
    needResetDuplicateSearch: boolean;
    duplicateSearchObj?: Zotero.Search;
    // @ts-ignore
    duplicateSets?: Zotero.DisjointSetForest;
    tempTables: Set<string>;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
      dialogs: {},
      refreshDuplicateStats: true,
      needResetDuplicateSearch: true,
      tempTables: new Set<string>(),
    };
    this.hooks = hooks;
    this.api = {};
  }

  public reset() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
      dialogs: {},
      refreshDuplicateStats: true,
      needResetDuplicateSearch: true,
      tempTables: new Set<string>(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
