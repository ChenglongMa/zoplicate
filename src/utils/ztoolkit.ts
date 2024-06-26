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
  _ztoolkit.basicOptions.debug.disableDebugBridgePassword = __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  // TODO: Uncomment the following line to set the icon URI for the progress window
  // _ztoolkit.ProgressWindow.setIconURI("default", `chrome://${config.addonRef}/content/icons/preficon.svg`);
}

import { BasicTool, makeHelperTool, unregister } from "zotero-plugin-toolkit/dist/basic";
import { UITool } from "zotero-plugin-toolkit/dist/tools/ui";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import { ProgressWindowHelper } from "zotero-plugin-toolkit/dist/helpers/progressWindow";
import { PatchHelper } from "zotero-plugin-toolkit/dist/helpers/patch";
import { MenuManager } from "zotero-plugin-toolkit/dist/managers/menu";

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
    if (addon.data.nonDuplicateSectionID) {
      Zotero.ItemPaneManager.unregisterSection(addon.data.nonDuplicateSectionID);
    }
  }
}
