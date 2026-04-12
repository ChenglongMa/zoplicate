import { config } from "../../package.json";
import { showingDuplicateStats } from "../utils/prefs";
import { toggleNonDuplicates } from "./nonDuplicates";
import { NonDuplicatesDB } from "../db/nonDuplicates";
import { fetchAllDuplicates, fetchDuplicates } from "../utils/duplicates";
import { menuCache } from "./menuCache";
import { getString } from "../utils/locale";

/**
 * Register all menus via Zotero.MenuManager (Zotero 9 API).
 * Returns an array of registered menu IDs for later cleanup.
 */
export function registerMenus(): string[] {
  const ids: string[] = [];

  const itemMenuID = registerItemMenu();
  if (itemMenuID) {
    ids.push(itemMenuID);
  }

  const collectionMenuID = registerCollectionMenu();
  if (collectionMenuID) {
    ids.push(collectionMenuID);
  }

  return ids;
}

/**
 * Unregister all menus by their IDs.
 */
export function unregisterMenus(ids: string[]): void {
  for (const id of ids) {
    Zotero.MenuManager.unregisterMenu(id);
  }
}

/**
 * Warm the menu visibility cache for a set of item IDs.
 * Queries NonDuplicatesDB and fetchDuplicates to populate the cache.
 */
export async function warmCache(itemIDs: number[]): Promise<void> {
  if (itemIDs.length < 2) {
    return;
  }

  const key = menuCache.buildKey(itemIDs);
  const isNonDuplicate = await NonDuplicatesDB.instance.existsNonDuplicates(itemIDs);

  const { duplicatesObj } = await fetchDuplicates();
  const duplicateSet = new Set(duplicatesObj.getSetItemsByItemID(itemIDs[0]));
  const isDuplicateSet = itemIDs.every((id) => duplicateSet.has(id));

  menuCache.set(key, { isNonDuplicate, isDuplicateSet });
}

// ---------------------------------------------------------------------------
// Item context menu (submenu with mark/unmark children)
// ---------------------------------------------------------------------------

function registerItemMenu(): string | false {
  return Zotero.MenuManager.registerMenu({
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: `${config.addonRef}-menu-submenu-title`,
        icon: "chrome://zotero/skin/16/universal/duplicate.svg",
        onShowing(event: Event, context: Zotero.MenuContext) {
          const items = context.items;
          if (!items || items.length < 2) {
            context.setVisible(false);
            return;
          }

          const itemIDs = items.map((item) => item.id);
          const key = menuCache.buildKey(itemIDs);
          const cached = menuCache.get(key);

          if (!cached) {
            // Cache miss: show submenu but disable it; fire async warm
            context.setVisible(true);
            context.setEnabled(false);
            // Fire-and-forget cache warming for next open
            warmCache(itemIDs);
            return;
          }

          // Cache hit: show submenu if relevant
          const show = cached.isNonDuplicate || cached.isDuplicateSet;
          context.setVisible(show);
          context.setEnabled(show);
        },
        menus: [
          {
            menuType: "menuitem",
            l10nID: `${config.addonRef}-menu-unmark-non-duplicate`,
            icon: "chrome://zotero/skin/16/universal/duplicate.svg",
            onShowing(event: Event, context: Zotero.MenuContext) {
              const items = context.items;
              if (!items || items.length < 2) {
                context.setVisible(false);
                return;
              }
              const key = menuCache.buildKey(items.map((i) => i.id));
              const cached = menuCache.get(key);
              context.setVisible(cached?.isNonDuplicate === true);
            },
            onCommand(event: Event, context: Zotero.MenuContext) {
              const items = context.items;
              if (!items || items.length < 2) return;
              toggleNonDuplicates("unmark", items, items[0].libraryID);
            },
          },
          {
            menuType: "menuitem",
            l10nID: `${config.addonRef}-menu-mark-non-duplicate`,
            icon: `chrome://${config.addonRef}/content/icons/menu/non-duplicate.svg`,
            onShowing(event: Event, context: Zotero.MenuContext) {
              const items = context.items;
              if (!items || items.length < 2) {
                context.setVisible(false);
                return;
              }
              const key = menuCache.buildKey(items.map((i) => i.id));
              const cached = menuCache.get(key);
              // Show mark option only when items are in the same duplicate set
              // and are NOT already marked as non-duplicates
              context.setVisible(cached?.isDuplicateSet === true && cached?.isNonDuplicate !== true);
            },
            onCommand(event: Event, context: Zotero.MenuContext) {
              const items = context.items;
              if (!items || items.length < 2) return;
              toggleNonDuplicates("mark", items, items[0].libraryID);
            },
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Collection context menu (refresh duplicates)
// ---------------------------------------------------------------------------

function registerCollectionMenu(): string | false {
  return Zotero.MenuManager.registerMenu({
    pluginID: config.addonID,
    target: "main/library/collection",
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-menu-refresh-duplicates`,
        icon: "chrome://zotero/skin/16/universal/sync.svg",
        onShowing(event: Event, context: Zotero.MenuContext) {
          const showStats = showingDuplicateStats();
          const row = context.collectionTreeRow as { isDuplicates?: () => boolean } | undefined;
          const inDuplicates = row?.isDuplicates?.() ?? false;
          context.setVisible(showStats && inDuplicates);
        },
        onCommand(event: Event, _context: Zotero.MenuContext) {
          fetchAllDuplicates(true).then(() => {
            new ztoolkit.ProgressWindow(getString("menuitem-refresh-duplicates"), {
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
      },
    ],
  });
}

export default {
  registerMenus,
  unregisterMenus,
  warmCache,
};
