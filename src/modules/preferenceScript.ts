import { config, homepage } from "../../package.json";
import { getString } from "../utils/locale";

export function registerPrefs() {
  ztoolkit.PreferencePane.register({
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    helpURL: homepage,
    defaultXUL: true,
  });
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/chrome/content/preferences.xul onpaneload
  addon.data.prefs = {
    window: _window,
  };

  updatePrefsUI();
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
}
