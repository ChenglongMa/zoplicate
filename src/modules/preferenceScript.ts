import { config, homepage } from "../../package.json";
import { getString } from "../utils/locale";
import { fetchAllDuplicates } from "../utils/duplicates";

export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/preficon.svg`,
    stylesheets:[`chrome://${config.addonRef}/content/prefs.css`],
    helpURL: homepage,
  });
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/chrome/content/preferences.xul onpaneload
  addon.data.prefs = {
    window: _window,
  };

  await updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  // You can initialize some UI elements on prefs window
  // with addon.data.prefs.window.document
  // Or bind some events to the elements
  // Refer to:
  // https://github.com/windingwind/zotero-plugin-template/blob/main/src/modules/preferenceScript.ts#L44-L107
}

function bindPrefEvents() {
  // Refer to:
  // https://github.com/windingwind/zotero-plugin-template/blob/main/src/modules/preferenceScript.ts#L109-L130
  addon.data
    .prefs!.window.document.querySelector(`#zotero-prefpane-${config.addonRef}-view-duplicate-stats-enable`)
    ?.addEventListener("command", async (e) => {
      if ((e.target as XUL.Checkbox).checked) {
        await fetchAllDuplicates();
      }
      // refreshCollectionView(); // Not respond to mouse click event
      // Show `unique/total` UI in collection tree
      await Zotero.Notifier.trigger('redraw', 'collection', []);
    });
}
