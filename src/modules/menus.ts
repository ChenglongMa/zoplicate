import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { showingDuplicateStats } from "../utils/prefs";
import { fetchAllDuplicates, fetchDuplicates } from "./duplicates";
import { MenuManager } from "zotero-plugin-toolkit/dist/managers/menu";
import { SQLiteDB } from "./db";
import { isInDuplicatesPane } from "../utils/zotero";
import MenuPopup = XUL.MenuPopup;
import { toggleNonDuplicates } from "./nonDuplicates";

function registerMenus(win: Window) {
  const menuManager = new ztoolkit.Menu();
  registerDuplicateCollectionMenu(menuManager);
  registerItemsViewMenu(menuManager, win);
}

function registerItemsViewMenu(menuManager: MenuManager, win: Window) {
  const nonDuplicateMenuTitle = getString("menuitem-not-duplicate");
  const isDuplicateMenuTitle = getString("menuitem-is-duplicate");
  let showingIsDuplicate = false;
  let showingNotDuplicate = false;
  menuManager.register("item", {
    tag: "menu",
    label: config.addonName,
    id: `${config.addonRef}-itemsview-menu`,
    icon: `chrome://zotero/skin/16/universal/duplicate.svg`,
    classList: ["zotero-menuitem-show-duplicates"],
    children: [
      {
        tag: "menuitem",
        icon: `chrome://zotero/skin/16/universal/duplicate.svg`,
        classList: ["zotero-menuitem-show-duplicates"],
        label: isDuplicateMenuTitle,
        id: `${config.addonRef}-menuitem-is-duplicate`,
        commandListener: async (ev) => {
          await toggleNonDuplicates("unmark");
        },
        getVisibility: (elem, ev) => {
          return showingIsDuplicate;
        },
      },
      {
        tag: "menuitem",
        classList: ["zotero-menuitem-show-duplicates"],
        label: nonDuplicateMenuTitle,
        id: `${config.addonRef}-menuitem-not-duplicate`,
        icon: `chrome://${config.addonRef}/content/icons/menu/non-duplicate.svg`,
        commandListener: async (ev) => {
          await toggleNonDuplicates("mark");
        },
        getVisibility: (elem, ev) => {
          return showingNotDuplicate;
        },
      },
    ],
  });

  function setVisibilityListeners(win: Window) {
    const menu = win.document.getElementById("zotero-itemmenu") as HTMLElement;
    menu.addEventListener("popupshowing", async (ev) => {
      const target = ev.target as MenuPopup;
      if (target.id !== "zotero-itemmenu") {
        return;
      }
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      const mainMenu = win.document.getElementById(`${config.addonRef}-itemsview-menu`) as HTMLElement;
      const showing = selectedItems.length > 1;
      if (!showing) {
        mainMenu.setAttribute("hidden", "true");
        return;
      }
      mainMenu.removeAttribute("hidden");
      const isDuplicateMenuItem = win.document.getElementById(
        `${config.addonRef}-menuitem-is-duplicate`,
      ) as HTMLElement;
      const notDuplicateMenuItem = win.document.getElementById(
        `${config.addonRef}-menuitem-not-duplicate`,
      ) as HTMLElement;
      const itemIDs = selectedItems.map((item) => item.id);
      showingIsDuplicate = await SQLiteDB.getInstance().existsNonDuplicates(itemIDs);
      if (showingIsDuplicate) {
        isDuplicateMenuItem.removeAttribute("hidden");
        notDuplicateMenuItem.setAttribute("hidden", "true");
      } else {
        isDuplicateMenuItem.setAttribute("hidden", "true");

        const { duplicatesObj } = await fetchDuplicates();
        const duplicateItems = new Set(duplicatesObj.getSetItemsByItemID(itemIDs[0]));

        showingNotDuplicate = itemIDs.every((itemID) => duplicateItems.has(itemID));
        if (showingNotDuplicate) {
          notDuplicateMenuItem.removeAttribute("hidden");
        } else {
          notDuplicateMenuItem.setAttribute("hidden", "true");
          mainMenu.setAttribute("hidden", "true");
        }
      }
    });
  }

  setVisibilityListeners(win);
}

function registerDuplicateCollectionMenu(menuManager: MenuManager) {
  const menuTitle = getString("menuitem-refresh-duplicates");
  const menuIcon = `chrome://zotero/skin/16/universal/sync.svg`;
  menuManager.register("collection", {
    tag: "menuitem",
    classList: ["zotero-menuitem-sync"],
    id: `${config.addonRef}-menuitem-refresh-duplicate-stats`,
    label: menuTitle,
    commandListener: (ev) => {
      fetchAllDuplicates(true).then((r) => {
        new ztoolkit.ProgressWindow(menuTitle, {
          closeOnClick: true,
          closeTime: 2000,
        })
          .createLine({
            text: getString("refresh-duplicates-done"),
            type: "default",
            progress: 100,
          })
          .show();
      });
    },
    icon: menuIcon,
    getVisibility: (elem, ev) => {
      let showStats = showingDuplicateStats();
      return showStats && isInDuplicatesPane();
    },
  });
}

export default {
  registerMenus,
};
