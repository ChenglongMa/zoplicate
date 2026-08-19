import { config } from "../../../package.json";
import { showingDuplicateStats } from "../../shared/prefs";
import { fetchAllDuplicates } from "../../integrations/zotero/duplicateSearch";
import { getString } from "../../shared/locale";
import type { MenuConfig } from "../../integrations/zotero/menuManager";
import { menuCache } from "../../integrations/zotero/menuCache";

/**
 * Collection context menu: refresh duplicates.
 */
export function collectionMenuConfig(): MenuConfig {
  return {
    register(): string | false {
      return Zotero.MenuManager.registerMenu({
        menuID: `${config.addonRef}-duplicate-stats-collection-menu`,
        pluginID: config.addonID,
        target: "main/library/collection",
        menus: [
          {
            menuType: "menuitem",
            l10nID: `${config.addonRef}-menu-refresh-duplicates`,
            icon: "chrome://zotero/skin/16/universal/sync.svg",
            onShowing(event: Event, context: Zotero.MenuContext) {
              const showStats = showingDuplicateStats();
              if (!showStats) {
                context.setVisible(false);
                return;
              }

              const rows = context.collectionTreeRows;
              const inDuplicates = Array.isArray(rows)
                ? rows.some((row) => row?.isDuplicates?.())
                : (context.collectionTreeRow?.isDuplicates?.() ?? false);
              context.setVisible(showStats && inDuplicates);
            },
            onCommand(event: Event, _context: Zotero.MenuContext) {
              fetchAllDuplicates(true).then(() => {
                menuCache.invalidateAll();
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
    },
  };
}
