import { ColumnOptions } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { Action } from "./utils/prefs";
import { PatchHelper } from "zotero-plugin-toolkit/dist/helpers/patch";

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
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
