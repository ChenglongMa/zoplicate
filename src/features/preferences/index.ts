export { registerPrefs, registerPrefsScripts } from "./preferenceScript";
import type { Disposer } from "../../app/lifecycle";
import { registerPrefs } from "./preferenceScript";

// ---------------------------------------------------------------------------
// Two-level registration wrapper
// ---------------------------------------------------------------------------

/**
 * Global-level registration for the preferences feature.
 * Registers the preference pane in Zotero.
 */
export async function registerPreferencesGlobal(): Promise<Disposer> {
  registerPrefs();
  return () => {};
}
