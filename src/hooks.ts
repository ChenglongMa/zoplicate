import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefs, registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { Notifier } from "./modules/notifier";
import { registerStyleSheet } from "./utils/window";
import { BulkDuplicates } from "./modules/bulkDuplicates";
import { Duplicates } from "./modules/duplicates";
import views from "./modules/views";

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  // TODO: Remove this after zotero#3387 is merged
  if (__env__ === "development") {
    // Keep in sync with the scripts/startup.mjs
    const loadDevToolWhen = `Plugin ${config.addonID} startup`;
    ztoolkit.log(loadDevToolWhen);
  }
  initLocale();
  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();
  registerStyleSheet();
  registerPrefs();
  Notifier.registerNotifier();
  BulkDuplicates.getInstance().registerUIElements(win);
  await Duplicates.registerDuplicateStats();
  views.registerMenus();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialogs.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialogs.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this function clear.
 *
 * Refer to: https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/notifier.js
 */
async function onNotify(event: string, type: string, ids: Array<string | number>, extraData: { [key: string]: any }) {
  // You can add your code to the corresponding `notify type`
  // ztoolkit.log("notify", event, type, ids, extraData);

  if (type == "item") {
    const { duplicatesObj } = await onItemsChanged();
    if (event == "add") {
      await Notifier.whenItemsAdded(duplicatesObj, ids as number[]);
    }
  }
}

async function onItemsChanged(libraryID = ZoteroPane.getSelectedLibraryID()) {
  const { duplicatesObj, duplicateItems } = await Duplicates.getDuplicates(libraryID);
  await Notifier.whenItemsChanged(libraryID, duplicatesObj, duplicateItems);
  return { libraryID, duplicatesObj, duplicateItems };
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {}

async function onDialogEvents(type: string) {}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onItemsChanged,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
