import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import { Duplicates } from "./duplicates";

function registerMenus() {
  const menuManager = new ztoolkit.Menu();
  const menuTitle = getString("menuitem-refresh-duplicate-stats");
  const menuIcon = `chrome://zotero/skin/16/universal/sync.svg`;
  // item menuitem with icon
  menuManager.register("collection", {
    tag: "menuitem",
    classList: ["zotero-menuitem-sync"],
    id: `${config.addonRef}-menuitem-refresh-duplicate-stats`,
    label: menuTitle,
    commandListener: (ev) => {
      Duplicates.refreshDuplicateStats(true).then((r) => {
        new ztoolkit.ProgressWindow(menuTitle, {
          closeOnClick: true,
          closeTime: 2000,
        })
          .createLine({
            text: getString("refresh-duplicate-stats-done"),
            type: "default",
            progress: 100,
          })
          .show();
      });
    },
    icon: menuIcon,
    getVisibility: (elem, ev) => {
      let showStats = getPref("duplicate.stats.enable") as boolean;
      const collectionTree = Zotero.getActiveZoteroPane().getCollectionTreeRow();
      return showStats && collectionTree?.isDuplicates();
    },
  });
}

export default {
  registerMenus,
};
