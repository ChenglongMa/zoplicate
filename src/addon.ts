import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { config } from "../package.json";
import type { AppState } from "./utils/state";

class Addon {
  public data: AppState;
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      database: "SQLite",
      ztoolkit: createZToolkit(),
      dialogs: {},
      needResetDuplicateSearch: {},
      duplicateSearchObj: {},
      duplicateCounts: {},
      duplicateSets: {},
      nonDuplicateSectionID: false,
      menuRegisteredIDs: [],
      processing: false,
    };
    this.hooks = hooks;
    this.api = {};
  }

  public reset() {
    // TODO: To be implemented
    this.data = {
      alive: true,
      config,
      env: __env__,
      database: "SQLite",
      ztoolkit: createZToolkit(),
      dialogs: {},
      needResetDuplicateSearch: {},
      duplicateSearchObj: {},
      duplicateCounts: {},
      duplicateSets: {},
      nonDuplicateSectionID: false,
      menuRegisteredIDs: [],
      processing: false,
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
