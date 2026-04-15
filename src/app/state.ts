/**
 * Typed AppState interface and scoped accessor functions.
 *
 * This module defines the shape of `addon.data` and provides accessor
 * functions so that consumer modules never reference `addon.data` directly.
 *
 * IMPORTANT: This file must NOT import from `addon.ts`.  It reads the
 * global `addon` variable declared in `typings/global.d.ts`.
 */

import type { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import type { Action } from "../shared/prefs";

// ---------------------------------------------------------------------------
// Sub-state interfaces
// ---------------------------------------------------------------------------

export interface LocaleState {
  current: any;
}

export interface PrefsWindowState {
  window: Window;
  columns?: Array<ColumnOptions>;
  rows?: Array<{ [dataKey: string]: string }>;
}

export interface DialogState {
  dialog?: DialogHelper;
  duplicateMaps?: DuplicateGroupMap;
}

export interface DuplicateGroupEntry {
  itemIDs: number[];
  newItemIDs: number[];
  action: Action;
}

export type DuplicateGroupMap = Map<number, DuplicateGroupEntry>;

export interface DuplicateCache {
  needResetDuplicateSearch: { [libraryID: number]: boolean };
  duplicateSearchObj: { [libraryID: number]: Zotero.Search };
  duplicateSets: { [libraryID: number]: typeof Zotero.DisjointSetForest };
}

export interface DuplicateStatsState {
  duplicateCounts: { [libraryID: number]: { total: number; unique: number } };
}

// ---------------------------------------------------------------------------
// AppState (the full shape of addon.data)
// ---------------------------------------------------------------------------

export interface AppState extends DuplicateCache, DuplicateStatsState {
  alive: boolean;
  config: {
    addonName: string;
    addonID: string;
    addonRef: string;
    addonInstance: string;
    prefsPrefix: string;
  };
  env: "development" | "production";
  database: "SQLite" | "IndexedDB";
  ztoolkit: ZToolkit;
  locale?: LocaleState;
  prefs?: PrefsWindowState;
  dialogs: DialogState;
  nonDuplicateSectionID: string | false;
  menuRegisteredIDs: string[];
  processing: boolean;
}

// ---------------------------------------------------------------------------
// Accessor functions
// ---------------------------------------------------------------------------

/** Return the current build environment. */
export function getEnv(): AppState["env"] {
  return addon.data.env;
}

/** Whether the addon is still alive (not shut down). */
export function isAlive(): boolean {
  return addon?.data?.alive ?? false;
}

/** Set the alive flag. */
export function setAlive(value: boolean): void {
  addon.data.alive = value;
}

/** Return the locale sub-state (may be undefined before initLocale). */
export function getLocale(): LocaleState | undefined {
  return addon.data.locale;
}

/** Set the locale sub-state. */
export function setLocale(value: LocaleState): void {
  addon.data.locale = value;
}

/** Return the prefs sub-state (may be undefined before prefs window opens). */
export function getPrefs(): PrefsWindowState | undefined {
  return addon.data.prefs;
}

/** Set the prefs sub-state. */
export function setPrefs(value: PrefsWindowState): void {
  addon.data.prefs = value;
}

/** Return a mutable reference to the dialogs sub-state. */
export function getDialogs(): DialogState {
  return addon.data.dialogs;
}

/** Return the static config object. */
export function getConfig(): AppState["config"] {
  return addon.data.config;
}

/** Return the list of registered menu IDs. */
export function getMenuRegisteredIDs(): string[] {
  return addon.data.menuRegisteredIDs;
}

/** Replace the list of registered menu IDs. */
export function setMenuRegisteredIDs(ids: string[]): void {
  addon.data.menuRegisteredIDs = ids;
}

/** Return the non-duplicate section ID (or false). */
export function getNonDuplicateSectionID(): string | false {
  return addon.data.nonDuplicateSectionID;
}

/** Set the non-duplicate section ID. */
export function setNonDuplicateSectionID(value: string | false): void {
  addon.data.nonDuplicateSectionID = value;
}

/** Return the duplicate counts map. */
export function getDuplicateCounts(): AppState["duplicateCounts"] {
  return addon.data.duplicateCounts;
}

/** Set the duplicate counts for a specific library. */
export function setDuplicateCounts(
  libraryID: number,
  counts: { total: number; unique: number },
): void {
  addon.data.duplicateCounts[libraryID] = counts;
}

/** Mark the duplicate search as dirty for a given library. */
export function markDuplicateSearchDirty(libraryID: number): void {
  addon.data.needResetDuplicateSearch[libraryID] = true;
}

/** Whether a bulk/auto merge is in progress. */
export function isProcessing(): boolean {
  return addon.data.processing;
}

/** Set the processing flag. */
export function setProcessing(value: boolean): void {
  addon.data.processing = value;
}

/** Safely close the current dialog window (no-op when absent). */
export function closeDialogWindow(): void {
  addon.data.dialogs.dialog?.window?.close();
}

/** Return the duplicate search object map. */
export function getDuplicateSearchObj(): AppState["duplicateSearchObj"] {
  return addon.data.duplicateSearchObj;
}

/** Set a search object entry for a library. */
export function setDuplicateSearchObj(
  libraryID: number,
  search: Zotero.Search,
): void {
  addon.data.duplicateSearchObj[libraryID] = search;
}

/** Return the duplicate sets map. */
export function getDuplicateSets(): AppState["duplicateSets"] {
  return addon.data.duplicateSets;
}

/** Set a duplicate set entry for a library. */
export function setDuplicateSets(
  libraryID: number,
  sets: typeof Zotero.DisjointSetForest,
): void {
  addon.data.duplicateSets[libraryID] = sets;
}

/** Return the needResetDuplicateSearch map. */
export function getNeedResetDuplicateSearch(): AppState["needResetDuplicateSearch"] {
  return addon.data.needResetDuplicateSearch;
}

/** Set needResetDuplicateSearch for a library. */
export function setNeedResetDuplicateSearch(
  libraryID: number,
  value: boolean,
): void {
  addon.data.needResetDuplicateSearch[libraryID] = value;
}
