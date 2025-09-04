import { config } from "../../package.json";

/**
 * Get preference value.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key
 */
export function getPref(key: string) {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
}

/**
 * Set preference value.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key
 * @param value
 */
export function setPref(key: string, value: string | number | boolean) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key
 */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}

export function showingDuplicateStats() {
  return getPref("duplicate.stats.enable") as boolean;
}

/**
 * NOTE: Corresponding to radio values in addon/chrome/content/preferences.xhtml.
 */
export enum Action {
  KEEP = "keep",
  DISCARD = "discard",
  CANCEL = "cancel",
  ASK = "ask",
}

/**
 * NOTE: Corresponding to radio values in addon/chrome/content/preferences.xhtml.
 */
export enum MasterItem {
  OLDEST = "oldest",
  NEWEST = "newest",
  MODIFIED = "modified",
  DETAILED = "detailed",
}

/**
 * NOTE: Corresponding to radio values in addon/chrome/content/preferences.xhtml.
 */
export enum TypeMismatch {
  SKIP = "skip",
  CONVERT = "convert",
  ASK = "ask"
}