export { registerPrefs, registerPrefsScripts } from "./preferenceScript";

// ---------------------------------------------------------------------------
// Two-level registration wrapper
// ---------------------------------------------------------------------------

/**
 * Global-level registration for the preferences feature.
 * Registers the preference pane in Zotero.
 */
export function registerPreferencesGlobal(): void {
  const { registerPrefs } = require("./preferenceScript");
  registerPrefs();
}
