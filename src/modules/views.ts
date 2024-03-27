import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import { Duplicates } from "./duplicates";
import { MenuManager } from "zotero-plugin-toolkit/dist/managers/menu";
import { DB } from "./db";

function registerMenus() {
  const menuManager = new ztoolkit.Menu();
  registerDuplicateCollectionMenu(menuManager);
  registerItemsViewMenu(menuManager);
}

function registerItemsViewMenu(menuManager: MenuManager) {
  const nonDuplicateMenuTitle = getString("menuitem-not-duplicate");
  const isDuplicateMenuTitle = getString("menuitem-is-duplicate");
  menuManager.register("item", {
    tag: "menu",
    label: config.addonName,
    id: `${config.addonRef}-itemsview-menu`,
    icon: `chrome://zotero/skin/16/universal/duplicate.svg`,
    classList: ["zotero-menuitem-sync"],
    children: [
      {
        tag: "menuitem",
        icon: `chrome://${config.addonRef}/content/icons/link.svg`,
        classList: ["zotero-menuitem-sync"],
        label: isDuplicateMenuTitle,
        commandListener: async (ev) => {
          const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
          await DB.getInstance().deleteNonDuplicates(selectedItems.map((item) => item.id));
        }
      },
      {
        tag: "menuitem",
        classList: ["zotero-menuitem-sync"],
        label: nonDuplicateMenuTitle,
        icon: `chrome://${config.addonRef}/content/icons/unlink.svg`,
        commandListener: async (ev) => {
          const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
          await DB.getInstance().insertNonDuplicates(selectedItems.map((item) => item.id));
        }
      },
    ],
    getVisibility: (elem, ev) => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return selectedItems.length > 1;
    },
  });
}

function registerDuplicateCollectionMenu(menuManager: MenuManager) {
  const menuTitle = getString("menuitem-refresh-duplicate-stats");
  const menuIcon = `chrome://zotero/skin/16/universal/sync.svg`;
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
