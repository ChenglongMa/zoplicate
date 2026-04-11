import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { showingDuplicateStats } from "../utils/prefs";
import { isInDuplicatesPane } from "../utils/zotero";
import MenuPopup = XUL.MenuPopup;
import { toggleNonDuplicates } from "./nonDuplicates";
import { NonDuplicatesDB } from "../db/nonDuplicates";
import { fetchAllDuplicates, fetchDuplicates } from "../utils/duplicates";
import type { LocalMenuRegistrar } from "../utils/menu";

function registerMenus(win: Window) {
  const menuManager = new ztoolkit.Menu();
  registerDuplicateCollectionMenu(menuManager, win);
  registerItemsViewMenu(menuManager, win);
}

function registerItemsViewMenu(menuManager: LocalMenuRegistrar, win: Window) {
  const itemMenu = win.document.querySelector("#zotero-itemmenu") as MenuPopup | null;
  if (!itemMenu) {
    return;
  }

  const nonDuplicateMenuTitle = getString("menuitem-not-duplicate");
  const isDuplicateMenuTitle = getString("menuitem-is-duplicate");
  let showingIsDuplicate = false;
  let showingNotDuplicate = false;
  menuManager.register(itemMenu, {
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
        isHidden: (elem, ev) => {
          return !showingIsDuplicate;
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
        isHidden: (elem, ev) => {
          return !showingNotDuplicate;
        },
      },
    ],
  });

  function setVisibilityListeners(win: Window) {
    const menu = win.document.getElementById("zotero-itemmenu") as HTMLElement;
    menu.addEventListener("popupshowing", (ev) => {
      const target = ev.target as MenuPopup;
      if (target.id !== "zotero-itemmenu") {
        return;
      }
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      const mainMenu = win.document.getElementById(`${config.addonRef}-itemsview-menu`) as HTMLElement;
      mainMenu.setAttribute("hidden", "true");
      const showing = selectedItems.length > 1;
      if (!showing) {
        return;
      }
      const isDuplicateMenuItem = win.document.getElementById(
        `${config.addonRef}-menuitem-is-duplicate`,
      ) as HTMLElement;
      const notDuplicateMenuItem = win.document.getElementById(
        `${config.addonRef}-menuitem-not-duplicate`,
      ) as HTMLElement;
      const itemIDs = selectedItems.map((item) => item.id);

      setTimeout(async () => {
        showingIsDuplicate = await NonDuplicatesDB.instance.existsNonDuplicates(itemIDs);
        if (showingIsDuplicate) {
          mainMenu.removeAttribute("hidden");
          isDuplicateMenuItem.removeAttribute("hidden");
          notDuplicateMenuItem.setAttribute("hidden", "true");
        } else {
          isDuplicateMenuItem.setAttribute("hidden", "true");

          const { duplicatesObj } = await fetchDuplicates();
          const duplicateItems = new Set(duplicatesObj.getSetItemsByItemID(itemIDs[0]));

          showingNotDuplicate = itemIDs.every((itemID) => duplicateItems.has(itemID));
          if (showingNotDuplicate) {
            mainMenu.removeAttribute("hidden");
            notDuplicateMenuItem.removeAttribute("hidden");
          } else {
            notDuplicateMenuItem.setAttribute("hidden", "true");
            mainMenu.setAttribute("hidden", "true");
          }
        }
      }, 0);
    });
  }

  setVisibilityListeners(win);
}

function registerDuplicateCollectionMenu(menuManager: LocalMenuRegistrar, win: Window) {
  const collectionMenu = win.document.querySelector("#zotero-collectionmenu") as MenuPopup | null;
  if (!collectionMenu) {
    return;
  }

  const menuTitle = getString("menuitem-refresh-duplicates");
  const menuIcon = `chrome://zotero/skin/16/universal/sync.svg`;
  menuManager.register(collectionMenu, {
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
    isHidden: (elem, ev) => {
      const showStats = showingDuplicateStats();
      return !(showStats && isInDuplicatesPane());
    },
  });
}

export default {
  registerMenus,
};
