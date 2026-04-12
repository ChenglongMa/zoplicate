import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefs, registerPrefsScripts } from "./modules/preferenceScript";
import { whenItemsDeleted, registerNotifier } from "./modules/notifier";
import { registerStyleSheets } from "./utils/window";
import { BulkDuplicates } from "./modules/bulkDuplicates";
import { Duplicates, registerButtonsInDuplicatePane } from "./modules/duplicates";
import { registerMenus, unregisterMenus } from "./modules/menus";
import { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./modules/nonDuplicates";
import {
  patchFindDuplicates,
  patchGetSearchObject,
  patchItemSaveData,
} from "./modules/patches";
import { containsRegularItem, debug, isInDuplicatesPane, refreshItemTree } from "./utils/zotero";
import { registerDuplicateStats } from "./modules/duplicateStats";
import { NonDuplicatesDB } from "./db/nonDuplicates";
import { fetchDuplicates } from "./utils/duplicates";
import { menuCache } from "./modules/menuCache";
import {
  getEnv,
  setAlive,
  closeDialogWindow,
} from "./utils/state";
import { DisposerRegistry } from "./lifecycle";

// ---------------------------------------------------------------------------
// Disposer registries
// ---------------------------------------------------------------------------

const globalDisposers = new DisposerRegistry();
const windowDisposers = new WeakMap<Window, DisposerRegistry>();

let mainWindowLoaded = false;
const notifyQueue: { event: string; type: string; ids: number[] | string[]; extraData: { [key: string]: any } }[] = [];

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  initLocale();
  ztoolkit.log("addon onStartup");
  registerPrefs();

  // Notifier -- returns disposer
  globalDisposers.add(registerNotifier());

  // init database
  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();

  // Patches -- each returns a disposer
  globalDisposers.add(patchFindDuplicates(nonDuplicatesDB));
  globalDisposers.add(patchGetSearchObject());
  globalDisposers.add(patchItemSaveData());

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Register menus at startup level (MenuManager handles multi-window internally).
  // FTL is loaded in onMainWindowLoad before this point.
  const menuIDs = registerMenus();
  globalDisposers.add(() => {
    unregisterMenus(menuIDs);
  });
}

async function onMainWindowLoad(win: Window): Promise<void> {
  ztoolkit.log("addon onMainWindowLoad");
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-itemSection.ftl`);
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
  registerStyleSheets(win);

  const winRegistry = new DisposerRegistry();
  windowDisposers.set(win, winRegistry);

  // register duplicate UI elements
  const statsDisposer = await registerDuplicateStats(win);
  winRegistry.add(statsDisposer);

  // DOM buttons cleaned by window destruction -- no disposer needed
  await registerButtonsInDuplicatePane(win);

  const bulkDisposer = BulkDuplicates.instance.registerUIElements(win);
  winRegistry.add(bulkDisposer);

  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();
  registerNonDuplicatesSection(nonDuplicatesDB);
  winRegistry.add(() => {
    unregisterNonDuplicatesSection();
  });

  if (getEnv() === "development") {
    await registerDevColumn();
  }
  mainWindowLoaded = true;
  setTimeout(async () => {
    while (notifyQueue.length > 0) {
      const { event, type, ids, extraData } = notifyQueue.shift()!;
      debug("notify shift", event, type, ids, extraData);
      await onNotify(event, type, ids, extraData);
    }
  }, 500);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  debug("addon onMainWindowUnload");
  mainWindowLoaded = false;
  closeDialogWindow();

  const winRegistry = windowDisposers.get(win);
  if (winRegistry) {
    await winRegistry.disposeAll();
    windowDisposers.delete(win);
  }

  await NonDuplicatesDB.instance.close();
}

async function onShutdown() {
  debug("addon onShutdown");
  await globalDisposers.disposeAll();
  ztoolkit.unregisterAll();
  closeDialogWindow();
  await NonDuplicatesDB.instance.close();
  // Remove addon object
  setAlive(false);
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

/**
 * Register a custom column for development purpose.
 */
async function registerDevColumn() {
  const field = "Item ID";
  await Zotero.ItemTreeManager.registerColumns({
    pluginID: config.addonID,
    dataKey: field,
    label: "Item ID",
    dataProvider: (item: Zotero.Item, dataKey: string) => {
      return String(item.id) + " " + item.key;
    },
  });
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this function clear.
 *
 * Refer to: https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/notifier.js
 */
async function onNotify(event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) {
  if (!mainWindowLoaded) {
    debug("notify queue", event, type, ids, extraData);
    notifyQueue.push({ event, type, ids, extraData });
    return;
  }

  // You can add your code to the corresponding `notify type`
  ztoolkit.log("notify", event, type, ids, extraData);

  // Invalidate menu visibility cache on item changes that may affect duplicate status
  if (type == "item" || type == "trash") {
    menuCache.invalidateAll();
  }

  const isDeleted = type == "item" && event == "delete" && ids.length > 0;

  if (isDeleted) {
    await whenItemsDeleted(ids as number[]);
    return;
  }

  const precondition = ids && ids.length > 0 && !BulkDuplicates.instance.isRunning;

  if (!precondition) {
    // ignore when bulk duplicates is running and no ids
    return;
  }

  if (type == "item" && event == "removeDuplicatesMaster" && isInDuplicatesPane()) {
    refreshItemTree();
    return;
  }

  let libraryIDs = [Zotero.getActiveZoteroPane().getSelectedLibraryID()];

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
      await Duplicates.instance.whenItemsAdded(duplicatesObj, ids as number[]);
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
