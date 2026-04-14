import { config } from "../../../package.json";
import { toggleNonDuplicates } from "./nonDuplicateActions";
import { menuCache, warmCache } from "../../integrations/zotero/menuCache";
import type { MenuConfig } from "../../integrations/zotero/menuManager";
import { getWindowFromEvent } from "../../integrations/zotero/windows";

/**
 * Item context menu: submenu with mark/unmark non-duplicate children.
 */
export function itemMenuConfig(): MenuConfig {
  return {
    register(): string | false {
      return Zotero.MenuManager.registerMenu({
        pluginID: config.addonID,
        target: "main/library/item",
        menus: [
          {
            menuType: "submenu",
            l10nID: `${config.addonRef}-addon-name`,
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
                warmCache(itemIDs, items[0].libraryID);
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
                  toggleNonDuplicates("unmark", items, items[0].libraryID, { win: getWindowFromEvent(event) });
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
                  toggleNonDuplicates("mark", items, items[0].libraryID, { win: getWindowFromEvent(event) });
                },
              },
            ],
          },
        ],
      });
    },
  };
}
