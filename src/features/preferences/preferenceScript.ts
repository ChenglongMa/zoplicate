import { config, homepage } from "../../../package.json";
import { getString } from "../../shared/locale";
import { fetchAllDuplicates } from "../../shared/duplicateQueries";
import { setPrefs, getPrefs } from "../../app/state";

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
  setPrefs({
    window: _window,
  });

  await updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  // Initialize UI elements on prefs window, or bind events to the elements.
}

function bindPrefEvents() {
  getPrefs()
    ?.window.document.querySelector(`#zotero-prefpane-${config.addonRef}-view-duplicate-stats-enable`)
    ?.addEventListener("command", async (e) => {
      if ((e.target as XUL.Checkbox).checked) {
        await fetchAllDuplicates();
      }
      // refreshCollectionView(); // Not respond to mouse click event
      // Show `unique/total` UI in collection tree
      await Zotero.Notifier.trigger('redraw', 'collection', []);
    });
}
