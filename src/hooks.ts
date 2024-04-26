import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefs, registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { Notifier } from "./modules/notifier";
import { registerStyleSheets } from "./utils/window";
import { BulkDuplicates } from "./modules/bulkDuplicates";
import { fetchDuplicates, registerButtonsInDuplicatePane } from "./modules/duplicates";
import menus from "./modules/menus";
// import "./modules/zduplicates.js";
import { IndexedDB } from "./modules/db";
import { NonDuplicates, registerNonDuplicatesSection } from "./modules/nonDuplicates";
import { patchGetSearchObject, patchItemSaveData } from "./modules/patcher";
import { containsRegularItem, isInDuplicatesPane, refreshItemTree } from "./utils/zotero";
import { registerDuplicateStats } from "./modules/duplicateStats";

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  // TODO: Remove this after zotero#3387 is merged
  // https://github.com/zotero/zotero/pull/3387
  if (__env__ === "development") {
    // Keep in sync with the scripts/startup.mjs
    const loadDevToolWhen = `Plugin ${config.addonID} startup`;
    ztoolkit.log(loadDevToolWhen);
  }
  initLocale();
  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  const db = IndexedDB.getInstance();
  await db.init();
  NonDuplicates.getInstance().init(db);
  registerNonDuplicatesSection(db);
  registerStyleSheets();
  registerPrefs();
  Notifier.registerNotifier();
  BulkDuplicates.getInstance().registerUIElements(win);
  menus.registerMenus(win);
  patchGetSearchObject();
  patchItemSaveData();
  await registerDuplicateStats();
  registerButtonsInDuplicatePane(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialogs.dialog?.window?.close();
  await IndexedDB.getInstance().close();
}

async function onShutdown() {
  ztoolkit.unregisterAll();
  addon.data.dialogs.dialog?.window?.close();
  await IndexedDB.getInstance().close();
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
async function onNotify(event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) {
  // You can add your code to the corresponding `notify type`
  ztoolkit.log("notify", event, type, ids, extraData);
  const precondition = ids && ids.length > 0 && !BulkDuplicates.getInstance().isRunning;

  if (!precondition) {
    // ignore when bulk duplicates is running and no ids
    return;
  }

  if (type == "item" && event == "removeDuplicatesMaster" && isInDuplicatesPane()) {
    refreshItemTree();
    return;
  }

  let libraryIDs = [ZoteroPane.getSelectedLibraryID()];

  const toRefresh =
    // subset of "modify" event (modification on item data and authors) on regular items
    (extraData && Object.values(extraData).some((data) => data.refreshDuplicates)) ||
    // "add" event on regular items
    (type == "item" && event == "add" && containsRegularItem(ids)) ||
    // "refresh" event on trash
    (type == "trash" && event == "refresh");

  ztoolkit.log("refreshDuplicates", toRefresh);

  if (toRefresh) {
    if (type == "item") {
      libraryIDs = ids.map((id) => Zotero.Items.get(id).libraryID);
    }
    if (type == "trash") {
      libraryIDs = ids as number[];
    }
    const libraryID = libraryIDs[0]; // normally only one libraryID
    const { duplicatesObj } = await fetchDuplicates({ libraryID, refresh: true });
    if (type == "item" && event == "add") {
      await Notifier.whenItemsAdded(duplicatesObj, ids as number[]);
    }
  }
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
      await registerPrefsScripts(data.window);
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
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
