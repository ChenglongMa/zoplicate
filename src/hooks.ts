import { config } from "../package.json";
import { initLocale } from "./shared/locale";
import { registerPreferencesGlobal, registerPrefsScripts } from "./features/preferences";
import { registerNotifier } from "./integrations/zotero/notifier";
import { registerStyleSheets } from "./shared/window";
import { BulkDuplicates } from "./features/bulk-merge";
import {
  registerDuplicatesGlobal,
  registerDuplicatesWindow,
  refreshDuplicateStats,
  updateDuplicateButtonsVisibilities,
} from "./features/duplicates";
import { createNonDuplicateButton, registerNonDuplicatesGlobal, registerNonDuplicatesWindow } from "./features/non-duplicates";
import { registerMenus, unregisterMenus } from "./integrations/zotero/menuManager";
import {
  patchFindDuplicates,
  patchGetSearchObject,
  patchItemSaveData,
} from "./integrations/zotero/patches";
import { debug } from "./shared/zotero";
import { NonDuplicatesDB } from "./db/nonDuplicates";
import { menuCache } from "./integrations/zotero/menuCache";
import {
  getEnv,
  setAlive,
  closeDialogWindow,
} from "./app/state";
import { DisposerRegistry } from "./app/lifecycle";
import { NonDuplicates } from "./features/non-duplicates";

// ---------------------------------------------------------------------------
// Disposer registries
// ---------------------------------------------------------------------------

const globalDisposers = new DisposerRegistry();
const windowDisposers = new WeakMap<Window, DisposerRegistry>();

let mainWindowLoaded = false;
const notifyQueue: { event: string; type: string; ids: number[] | string[]; extraData: { [key: string]: any } }[] = [];

// ---------------------------------------------------------------------------
// Feature notify handlers (populated during window registration)
// ---------------------------------------------------------------------------

type NotifyHandler = (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => Promise<void>;
type DeleteHandler = (ids: number[]) => Promise<void>;

let duplicatesNotifyHandler: NotifyHandler | null = null;
let nonDuplicatesDeleteHandler: DeleteHandler | null = null;

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  initLocale();
  ztoolkit.log("addon onStartup");

  // Preferences (global)
  registerPreferencesGlobal();

  // Notifier -- returns disposer
  globalDisposers.add(registerNotifier());

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
  duplicatesNotifyHandler = duplicatesResult.notifyHandler;

  // Bulk-merge feature (window-level)
  const { registerBulkMergeWindow } = await import("./features/bulk-merge");
  const bulkDisposer = registerBulkMergeWindow(win, updateDuplicateButtonsVisibilities);
  winRegistry.add(bulkDisposer);

  // Non-duplicates feature (window-level)
  const nonDuplicatesResult = await registerNonDuplicatesWindow(win);
  winRegistry.add(nonDuplicatesResult.disposer);
  nonDuplicatesDeleteHandler = nonDuplicatesResult.deleteHandler;

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

  // Clear feature notify handlers for this window
  duplicatesNotifyHandler = null;
  nonDuplicatesDeleteHandler = null;

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
 * Composition-root dispatcher for Notify events.
 * Queue/mainWindowLoaded gating stays here as infrastructure.
 * Business logic is delegated to feature notify handlers registered during window setup.
 *
 * menuCache invalidation is kept here as an infrastructure concern:
 * menuCache is an integration-level module, not a feature module.
 */
async function onNotify(event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) {
  if (!mainWindowLoaded) {
    debug("notify queue", event, type, ids, extraData);
    notifyQueue.push({ event, type, ids, extraData });
    return;
  }

  ztoolkit.log("notify", event, type, ids, extraData);

  // Infrastructure: invalidate menu visibility cache on item changes
  if (type == "item" || type == "trash") {
    menuCache.invalidateAll();
  }

  // Delegate to non-duplicates delete handler
  const isDeleted = type == "item" && event == "delete" && ids.length > 0;
  if (isDeleted && nonDuplicatesDeleteHandler) {
    await nonDuplicatesDeleteHandler(ids as number[]);
    return;
  }

  // Delegate to duplicates notify handler
  if (duplicatesNotifyHandler) {
    await duplicatesNotifyHandler(event, type, ids, extraData);
  }
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
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
