import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefs, registerPrefsScripts } from "./modules/preferenceScript";
import { Notifier } from "./modules/notifier";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`
  );
  registerPrefs();

  Notifier.registerNotifier();
  //
  // const popupWin = new ztoolkit.ProgressWindow(config.addonName, {
  //   closeOnClick: true,
  //   closeTime: -1,
  // })
  //   .createLine({
  //     text: getString("startup.begin"),
  //     type: "default",
  //     progress: 0,
  //   })
  //   .show();
  //
  // await Zotero.Promise.delay(1000);
  // popupWin.changeLine({
  //   progress: 30,
  //   text: `[30%] ${getString("startup.begin")}`,
  // });
  // await Zotero.Promise.delay(1000);
  //
  // popupWin.changeLine({
  //   progress: 100,
  //   text: `[100%] ${getString("startup.finish")}`,
  // });
  // popupWin.startCloseTimer(5000);
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
 */
async function onNotify(event: string, type: string, ids: Array<string | number>, extraData: { [key: string]: any }) {
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  if (event == "add" && type == "item") {
    await Notifier.whenAddItems(ids as number[]);
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
// Otherwise the code would be hard to read and maintian.

export default {
  onStartup,
  onShutdown,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
