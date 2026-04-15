import { config } from "../../package.json";
import { NonDuplicatesDB } from "../db/nonDuplicates";
import { bulkMergeController, registerBulkMergeWindow } from "../features/bulkMerge";
import {
  createDuplicatesNotifyHandler,
  registerDuplicatesGlobal,
  registerDuplicatesWindow,
  updateDuplicateButtonsVisibilities,
} from "../features/duplicates";
import {
  refreshDuplicateStats,
  registerDuplicateStatsGlobal,
  registerDuplicateStatsWindow,
} from "../features/duplicateStats";
import {
  createNonDuplicateButton,
  createNonDuplicatesNotifyHandler,
  NonDuplicates,
  registerNonDuplicatesGlobal,
  registerNonDuplicatesWindow,
} from "../features/nonDuplicates";
import { registerPreferencesGlobal, registerPrefsScripts } from "../features/preferences";
import { registerDevelopmentItemIDColumn } from "../integrations/zotero/devColumn";
import { createMenuCacheNotifyHandler } from "../integrations/zotero/menuCache";
import { notifyDispatcher, registerNotifier } from "../integrations/zotero/notifier";
import { registerStyleSheets } from "../integrations/zotero/windowChrome";
import { initLocale } from "../shared/locale";
import { debug } from "../shared/debug";
import { DisposerRegistry } from "./lifecycle";
import { closeDialogWindow, getEnv, setAlive } from "./state";

const globalDisposers = new DisposerRegistry();
const windowDisposers = new WeakMap<Window, DisposerRegistry>();
const loadedWindows = new Set<Window>();
let shutdownComplete = false;

async function onStartup() {
  shutdownComplete = false;
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  initLocale();
  ztoolkit.log("addon onStartup");

  globalDisposers.add(await registerPreferencesGlobal());

  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();
  globalDisposers.add(await registerNonDuplicatesGlobal(nonDuplicatesDB));
  globalDisposers.add(await registerDuplicateStatsGlobal());
  globalDisposers.add(
    await registerDuplicatesGlobal({
      nonDuplicatesDB,
      getNonDuplicatesState: () => NonDuplicates.getInstance(),
      refreshDuplicateStats,
    }),
  );

  globalDisposers.add(notifyDispatcher.registerHandler(createMenuCacheNotifyHandler()));
  globalDisposers.add(notifyDispatcher.registerHandler(createNonDuplicatesNotifyHandler()));
  globalDisposers.add(
    notifyDispatcher.registerHandler(
      createDuplicatesNotifyHandler(
        () => bulkMergeController.isRunning,
        () => [...loadedWindows],
      ),
    ),
  );
  globalDisposers.add(
    registerNotifier(
      (event, type, ids, extraData) => notifyDispatcher.dispatch(event, type, ids, extraData),
      { pluginID: config.addonID },
    ),
  );
  globalDisposers.add(await registerDevelopmentItemIDColumn(getEnv()));

  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));
}

async function onMainWindowLoad(win: Window): Promise<void> {
  ztoolkit.log("addon onMainWindowLoad");
  await disposeWindow(win);

  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-itemSection.ftl`);
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
  registerStyleSheets(win);

  const winRegistry = new DisposerRegistry();
  windowDisposers.set(win, winRegistry);

  winRegistry.add(
    await registerDuplicatesWindow(
      win,
      (w, id) => bulkMergeController.createBulkMergeButton(w, id),
      (w, id, showing) => createNonDuplicateButton(w, id, showing),
    ),
  );
  winRegistry.add(await registerDuplicateStatsWindow(win));
  winRegistry.add(await registerBulkMergeWindow(win, bulkMergeController, updateDuplicateButtonsVisibilities));
  winRegistry.add(await registerNonDuplicatesWindow(win));

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

async function disposeWindow(win: Window): Promise<void> {
  const winRegistry = windowDisposers.get(win);
  if (!winRegistry) {
    loadedWindows.delete(win);
    return;
  }
  await winRegistry.disposeAll();
  windowDisposers.delete(win);
}

async function disposeAllWindows(): Promise<void> {
  await Promise.all([...loadedWindows].map((win) => disposeWindow(win)));
}

async function onMainWindowUnload(win: Window): Promise<void> {
  debug("addon onMainWindowUnload");
  closeDialogWindow();
  await disposeWindow(win);
}

async function onShutdown() {
  if (shutdownComplete) {
    return;
  }
  shutdownComplete = true;
  debug("addon onShutdown");
  await disposeAllWindows();
  await globalDisposers.disposeAll();
  notifyDispatcher.reset();
  closeDialogWindow();
  await NonDuplicatesDB.instance.close();
  ztoolkit.unregisterAll();
  setAlive(false);
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

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
