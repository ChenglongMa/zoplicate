/**
 * Thin wrapper around Zotero.MenuManager.
 * Feature menu configs are passed in; this module handles registration and cleanup.
 */

export interface MenuConfig {
  register(): string | false;
}

/**
 * Register an array of menu configs and return the registered IDs.
 */
export function registerMenus(configs: MenuConfig[]): string[] {
  const ids: string[] = [];
  for (const config of configs) {
    const id = config.register();
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Unregister menus by their IDs.
 */
export function unregisterMenus(ids: string[]): void {
  for (const id of ids) {
    Zotero.MenuManager.unregisterMenu(id);
  }
}
