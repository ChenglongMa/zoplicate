import { config } from "../../package.json";
import { initLocale } from "../shared/locale";
import { registerPreferencesGlobal, registerPrefsScripts } from "../features/preferences";
import { registerNotifier, notifyDispatcher } from "../integrations/zotero/notifier";
import { registerStyleSheets } from "../shared/window";
import { BulkDuplicates } from "../features/bulk-merge";
import {
  registerDuplicatesGlobal,
  registerDuplicatesWindow,
  refreshDuplicateStats,
  updateDuplicateButtonsVisibilities,
} from "../features/duplicates";
import {
  createNonDuplicateButton,
  registerNonDuplicatesGlobal,
  registerNonDuplicatesWindow,
} from "../features/non-duplicates";
import { registerMenus, unregisterMenus } from "../integrations/zotero/menuManager";
import {
  patchFindDuplicates,
  patchGetSearchObject,
  patchItemSaveData,
} from "../integrations/zotero/patches";
import { debug } from "../shared/zotero";
import { NonDuplicatesDB } from "../db/nonDuplicates";
import { createMenuCacheNotifyHandler } from "../integrations/zotero/menuCache";
import {
  getEnv,
  setAlive,
  closeDialogWindow,
} from "./state";
import { DisposerRegistry } from "./lifecycle";
import { NonDuplicates } from "../features/non-duplicates";

// ---------------------------------------------------------------------------
// Disposer registries
// ---------------------------------------------------------------------------

const globalDisposers = new DisposerRegistry();
const windowDisposers = new WeakMap<Window, DisposerRegistry>();
const loadedWindows = new Set<Window>();

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  initLocale();
  ztoolkit.log("addon onStartup");

  // Preferences (global)
  registerPreferencesGlobal();

  globalDisposers.add(notifyDispatcher.registerHandler(createMenuCacheNotifyHandler()));
  globalDisposers.add(registerNotifier((event, type, ids, extraData) => notifyDispatcher.dispatch(event, type, ids, extraData)));

  // init database
  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();

  // Patches -- each returns a disposer
  globalDisposers.add(patchFindDuplicates(nonDuplicatesDB, () => NonDuplicates.getInstance()));
  globalDisposers.add(patchGetSearchObject(refreshDuplicateStats));
  globalDisposers.add(patchItemSaveData());

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Register menus at startup level (MenuManager handles multi-window internally).
  // FTL is loaded in onMainWindowLoad before this point.
  const menuIDs = registerMenus([
    registerNonDuplicatesGlobal(),
    registerDuplicatesGlobal(),
  ]);
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

  // Duplicates feature (window-level)
  const duplicatesResult = await registerDuplicatesWindow(
    win,
    (w, id) => BulkDuplicates.instance.createBulkMergeButton(w, id),
    (id, showing) => createNonDuplicateButton(id, showing),
    () => BulkDuplicates.instance.isRunning,
  );
  winRegistry.add(duplicatesResult.disposer);

  // Bulk-merge feature (window-level)
  const { registerBulkMergeWindow } = await import("../features/bulk-merge");
  const bulkDisposer = registerBulkMergeWindow(win, updateDuplicateButtonsVisibilities);
  winRegistry.add(bulkDisposer);

  // Non-duplicates feature (window-level)
  const nonDuplicatesResult = await registerNonDuplicatesWindow(win);
  winRegistry.add(nonDuplicatesResult.disposer);
  winRegistry.add(notifyDispatcher.registerHandler(nonDuplicatesResult.notifyHandler));
  winRegistry.add(notifyDispatcher.registerHandler(duplicatesResult.notifyHandler));

  if (getEnv() === "development") {
    await registerDevColumn();
  }
  loadedWindows.add(win);
  winRegistry.add(async () => {
    loadedWindows.delete(win);
    if (loadedWindows.size === 0) {
      await notifyDispatcher.setReady(false);
    }
  });
  setTimeout(() => {
    if (loadedWindows.has(win)) {
      void notifyDispatcher.setReady(true);
    }
  }, 500);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  debug("addon onMainWindowUnload");
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
  notifyDispatcher.reset();
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
 * Dispatcher for Preference UI events.
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

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
