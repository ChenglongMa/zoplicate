import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  // const _ztoolkit = new ZoteroToolkit();
  /**
   * Alternatively, import toolkit modules you use to minify the plugin size.
   * You can add the modules under the `MyToolkit` class below and uncomment the following line.
   */
  const _ztoolkit = new MyToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  const enableUILog = false; //__env__ === "development";
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = enableUILog;
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = enableUILog;
  // Getting basicOptions.debug will load global modules like the debug bridge.
  // since we want to deprecate it, should avoid using it unless necessary.
  // _ztoolkit.basicOptions.debug.disableDebugBridgePassword = __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  _ztoolkit.ProgressWindow.setIconURI("default", `chrome://${config.addonRef}/content/icons/preficon.svg`);
}

import { BasicTool, makeHelperTool, unregister } from "zotero-plugin-toolkit";
import { UITool } from "zotero-plugin-toolkit";
import { DialogHelper } from "zotero-plugin-toolkit";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { PatchHelper } from "zotero-plugin-toolkit";
import { MenuManager } from "zotero-plugin-toolkit";
import { debug } from "./zotero";
import { unregisterNonDuplicatesSection } from "../modules/nonDuplicates";

class MyToolkit extends BasicTool {
  UI: UITool;
  Dialog: typeof DialogHelper;
  ProgressWindow: typeof ProgressWindowHelper;
  Patch: typeof PatchHelper;
  Menu: typeof MenuManager;

  constructor() {
    super();
    this.UI = new UITool(this);
    this.ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
    this.Dialog = makeHelperTool(DialogHelper, this);
    this.Patch = makeHelperTool(PatchHelper, this);
    this.Menu = makeHelperTool(MenuManager, this);
  }

  unregisterAll() {
    unregister(this);
    unregisterNonDuplicatesSection();
    debug("zoplicate addon unregisterAll");
  }
}
