import { config } from "../../../package.json";
import { showingDuplicateStats } from "../../shared/prefs";
import { fetchAllDuplicates } from "../../shared/duplicateQueries";
import { getString } from "../../shared/locale";
import type { MenuConfig } from "../../integrations/zotero/menuManager";

/**
 * Collection context menu: refresh duplicates.
 */
export function collectionMenuConfig(): MenuConfig {
  return {
    register(): string | false {
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
    },
  };
}
