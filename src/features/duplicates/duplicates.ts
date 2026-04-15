import { config } from "../../../package.json";
import { getString } from "../../shared/locale";
import type { DialogHelper } from "zotero-plugin-toolkit";
import { Action, getPref, MasterItem, setPref } from "../../shared/prefs";
import { merge } from "../../shared/duplicates/mergeItems";
import { getFirstLiveWindow, getZoteroPane, goToDuplicatesPane, isWindowAlive } from "../../integrations/zotero/windows";
import { DuplicateItems } from "../../shared/duplicates/duplicateItems";
import { bringToFront } from "../../integrations/zotero/windowChrome";
import { showHintWithLink } from "../../shared/utils";
import { waitUntilAsync } from "../../shared/wait";
import { getDialogs, setProcessing, type DuplicateGroupEntry, type DuplicateGroupMap } from "../../app/state";
import {
  createDuplicatesDialogRenderer,
  type DuplicateDialogAction,
  type DuplicateDialogProps,
  type DuplicateDialogReactDOM,
  type DuplicateDialogRenderer,
  type DuplicateDialogRow,
  type DuplicateDialogState,
  type DuplicateDialogStrings,
} from "./duplicatesDialog";

interface DuplicateWindowOptions {
  win?: Window;
}

type LoadedWindowsProvider = () => Window[];

function normalizeItemIDs(itemIDs: number[]): number[] {
  return [...new Set(itemIDs)].sort((a, b) => a - b);
}

function getDuplicateGroupID(itemIDs: number[]): number {
  return Math.min(...itemIDs);
}

function findOverlappingGroupIDs(duplicateMaps: DuplicateGroupMap, groupID: number, itemIDs: number[]) {
  const incomingItemIDs = new Set(itemIDs);
  const overlappingGroupIDs: number[] = [];
  for (const [existingGroupID, value] of duplicateMaps) {
    if (existingGroupID === groupID || value.itemIDs.some((itemID) => incomingItemIDs.has(itemID))) {
      overlappingGroupIDs.push(existingGroupID);
    }
  }
  return overlappingGroupIDs;
}

function upsertDuplicateGroup(
  duplicateMaps: DuplicateGroupMap,
  groupID: number,
  incomingEntry: DuplicateGroupEntry,
  normalizeAction: (action: Action) => Action = (action) => action,
) {
  const existingGroupIDs = findOverlappingGroupIDs(duplicateMaps, groupID, incomingEntry.itemIDs);
  const existingEntries = existingGroupIDs
    .map((existingGroupID) => duplicateMaps.get(existingGroupID))
    .filter((entry): entry is DuplicateGroupEntry => Boolean(entry));
  const itemIDs = normalizeItemIDs([
    ...existingEntries.flatMap((entry) => entry.itemIDs),
    ...incomingEntry.itemIDs,
  ]);
  const newItemIDs = normalizeItemIDs([
    ...existingEntries.flatMap((entry) => entry.newItemIDs),
    ...incomingEntry.newItemIDs,
  ]);
  const nextGroupID = getDuplicateGroupID(itemIDs);

  existingGroupIDs.forEach((existingGroupID) => duplicateMaps.delete(existingGroupID));

  duplicateMaps.set(nextGroupID, {
    itemIDs,
    newItemIDs,
    action: normalizeAction(existingEntries[0]?.action ?? incomingEntry.action),
  });
}

export function buildDuplicateGroupMap(
  duplicatesObj: {
    getSetItemsByItemID(itemID: number): number[];
  },
  ids: number[],
  action: Action,
): DuplicateGroupMap {
  const duplicateMaps: DuplicateGroupMap = new Map();
  for (const id of ids) {
    const itemIDs = normalizeItemIDs([...duplicatesObj.getSetItemsByItemID(id), id]);
    if (itemIDs.length < 2) {
      continue;
    }

    const groupID = getDuplicateGroupID(itemIDs);
    upsertDuplicateGroup(duplicateMaps, groupID, {
      itemIDs,
      newItemIDs: [id],
      action,
    });
  }
  return duplicateMaps;
}

export class Duplicates {
  private static _instance: Duplicates;

  public static get instance() {
    if (!this._instance) {
      this._instance = new Duplicates();
    }
    return this._instance;
  }

  private constructor() {}

  private duplicateDialogRenderer?: DuplicateDialogRenderer;
  private duplicateDialogVersion = 0;
  private getLoadedWindows: LoadedWindowsProvider = () => [];
  private sourceWindow?: Window;

  setLoadedWindowsProvider(getLoadedWindows: LoadedWindowsProvider) {
    this.getLoadedWindows = getLoadedWindows;
  }

  clearWindowReferences() {
    this.getLoadedWindows = () => [];
    this.sourceWindow = undefined;
  }

  async whenItemsAdded(
    duplicatesObj: {
      getSetItemsByItemID(itemID: number): number[];
    },
    ids: Array<number>,
    options: DuplicateWindowOptions = {},
  ) {
    this.rememberSourceWindow(options.win);
    const defaultAction = getPref("duplicate.default.action") as Action;
    if (defaultAction === Action.CANCEL || ids.length === 0) {
      return;
    }

    const duplicateMaps = buildDuplicateGroupMap(duplicatesObj, ids, defaultAction);

    if (duplicateMaps.size === 0) return;

    if (defaultAction === Action.ASK) {
      await this.showDuplicates(duplicateMaps, options);
      return;
    }
    this.processDuplicates(duplicateMaps, options).then((r) => {}); // DONT WAIT
  }

  async processDuplicates(duplicateMaps: DuplicateGroupMap, options: DuplicateWindowOptions = {}) {
    this.rememberSourceWindow(options.win);
    if (duplicateMaps.size === 0) return;

    const popWin = new ztoolkit.ProgressWindow(getString("du-dialog-title"), {
      closeOnClick: true,
    })
      .createLine({
        text: getString("du-progress-text"),
        type: "default",
        progress: 0,
      })
      .show();
    setProcessing(true);
    const selectedItemIDs: number[] = [];

    try {
      const masterItemPref = getPref("bulk.master.item") as MasterItem;
      const processedItemIDs = new Set<number>();

      for (const [groupID, duplicateGroup] of duplicateMaps) {
        ztoolkit.log("Processing duplicate group: ", groupID, duplicateGroup);

        const activeItems = this.getActiveUniqueItems(duplicateGroup.itemIDs);
        if (activeItems.length < 2) {
          continue;
        }

        const activeItemIDs = activeItems.map((item) => item.id);
        if (activeItemIDs.some((itemID) => processedItemIDs.has(itemID))) {
          ztoolkit.log("Skipping duplicate group already processed: ", groupID, duplicateGroup);
          continue;
        }

        await this.waitForNewItemAttachments(duplicateGroup.newItemIDs, activeItemIDs);

        const mergePlan = this.createMergePlan(duplicateGroup, activeItems, masterItemPref);
        if (!mergePlan) {
          continue;
        }

        selectedItemIDs.push(mergePlan.masterItem.id);
        await merge(mergePlan.masterItem, mergePlan.otherItems);
        activeItemIDs.forEach((itemID) => processedItemIDs.add(itemID));
      }
    } finally {
      setProcessing(false);
    }

    popWin.changeLine({
      text: getString("du-progress-text"),
      type: "default",
      progress: 80,
    });

    const win = this.resolveLiveWindow(options.win);
    if (win && selectedItemIDs.length > 0) {
      getZoteroPane(win).selectItems(selectedItemIDs);
    } else if (selectedItemIDs.length > 0) {
      ztoolkit.log("Duplicate processing finished without a live window for item selection.", selectedItemIDs);
    }

    popWin.changeLine({
      text: getString("du-progress-done"),
      type: "success",
      progress: 100,
    });
  }

  async showDuplicates(duplicateMaps: DuplicateGroupMap, options: DuplicateWindowOptions = {}) {
    this.rememberSourceWindow(options.win);
    this.updateDuplicateMaps(duplicateMaps);

    if (!this.document?.hasFocus()) {
      await showHintWithLink(config.addonName, getString("du-dialog-title"), getString("du-dialog-hint"), async () => {
        bringToFront(this.dialogWindow ?? this.resolveLiveWindow(options.win));
      });
    }

    if (this.dialog) {
      await this.renderDuplicateDialog();
    } else {
      // If dialog is not opened, create dialog
      this.dialog = await this.createDialog();
      // Prevent the dialog from blocking the main thread
      new Promise((resolve) => {
        resolve(
          this.dialog?.open(getString("du-dialog-title"), {
            centerscreen: true,
            resizable: true,
            fitContent: true,
            noDialogMode: false,
            alwaysRaised: true,
          }),
        );
      }).then(async () => {
        await this.dialog?.dialogData?.unloadLock?.promise;
      });
    }
  }

  private get dialog(): DialogHelper | undefined {
    return getDialogs().dialog;
  }

  private set dialog(value: DialogHelper | undefined) {
    getDialogs().dialog = value;
  }

  private get duplicateMaps(): DuplicateGroupMap | undefined {
    return getDialogs().duplicateMaps;
  }

  private set duplicateMaps(value: DuplicateGroupMap | undefined) {
    getDialogs().duplicateMaps = value;
  }

  private get dialogWindow(): Window | undefined {
    return this.dialog?.window;
  }

  private get document(): Document | undefined {
    return isWindowAlive(this.dialogWindow) ? this.dialogWindow.document : undefined;
  }

  private rememberSourceWindow(win?: Window) {
    if (isWindowAlive(win)) {
      this.sourceWindow = win;
    }
  }

  private resolveLiveWindow(preferred?: Window): Window | undefined {
    return getFirstLiveWindow([preferred, this.sourceWindow, ...this.getLoadedWindows()]);
  }

  private updateDuplicateMaps(newDuplicateMaps: DuplicateGroupMap) {
    const mergedMaps = new Map(this.duplicateMaps ?? []);
    ztoolkit.log("Update duplicate maps - old", this.duplicateMaps);
    ztoolkit.log("Update duplicate maps - new", newDuplicateMaps);

    newDuplicateMaps.forEach((value, groupID) => {
      if (value.itemIDs.length < 2) return;
      upsertDuplicateGroup(mergedMaps, groupID, value, (action) => this.normalizeDialogAction(action));
    });

    this.duplicateMaps = mergedMaps;
  }

  private normalizeDialogAction(action: Action): DuplicateDialogAction {
    return action === Action.ASK ? Action.CANCEL : (action as DuplicateDialogAction);
  }

  private getActiveUniqueItems(itemIDs: number[]): Zotero.Item[] {
    const seenItemIDs = new Set<number>();
    const items: Zotero.Item[] = [];

    for (const itemID of itemIDs) {
      if (seenItemIDs.has(itemID)) continue;
      seenItemIDs.add(itemID);

      const item = Zotero.Items.get(itemID) as Zotero.Item | false | undefined;
      if (!item || item.deleted) continue;
      items.push(item);
    }
    return items;
  }

  private selectMasterItem(items: Zotero.Item[], masterItemPref: MasterItem): Zotero.Item | undefined {
    if (items.length === 0) return undefined;
    return new DuplicateItems(items, masterItemPref).masterItem;
  }

  private createMergePlan(
    duplicateGroup: DuplicateGroupEntry,
    activeItems: Zotero.Item[],
    masterItemPref: MasterItem,
  ): { masterItem: Zotero.Item; otherItems: Zotero.Item[] } | undefined {
    const activeItemByID = new Map(activeItems.map((item) => [item.id, item]));
    const activeNewItems = duplicateGroup.newItemIDs
      .map((itemID) => activeItemByID.get(itemID))
      .filter((item): item is Zotero.Item => Boolean(item));

    let masterItem: Zotero.Item | undefined;
    if (duplicateGroup.action === Action.KEEP) {
      masterItem = this.selectMasterItem(activeNewItems.length > 0 ? activeNewItems : activeItems, MasterItem.NEWEST);
    } else if (duplicateGroup.action === Action.DISCARD) {
      const newItemIDs = new Set(duplicateGroup.newItemIDs);
      const oldItems = activeItems.filter((item) => !newItemIDs.has(item.id));
      masterItem = this.selectMasterItem(
        oldItems.length > 0 ? oldItems : activeItems,
        oldItems.length > 0 ? masterItemPref : MasterItem.OLDEST,
      );
    } else {
      return undefined;
    }

    if (!masterItem) return undefined;

    const otherItems = activeItems.filter((item) => item.id !== masterItem.id);
    if (otherItems.length === 0) return undefined;

    return { masterItem, otherItems };
  }

  private async waitForNewItemAttachments(newItemIDs: number[], activeItemIDs: number[]) {
    const activeItemIDSet = new Set(activeItemIDs);
    for (const newItemID of newItemIDs) {
      if (!activeItemIDSet.has(newItemID)) continue;

      // TODO: Further check if the block is necessary
      try {
        // Wait for potential attachments to be downloaded
        await waitUntilAsync(() => Zotero.Items.get(newItemID).numAttachments() > 0, 1000, 5000);
      } catch (e) {
        ztoolkit.log(e);
      }
    }
  }

  private async createDialogRows(): Promise<DuplicateDialogRow[]> {
    const rows: DuplicateDialogRow[] = [];
    for (const [groupID, { itemIDs, action }] of this.duplicateMaps || []) {
      if (itemIDs.length < 2) continue;
      const item = await Zotero.Items.getAsync(groupID);
      rows.push({
        groupID,
        title: item.getDisplayTitle(),
        action: this.normalizeDialogAction(action),
      });
    }
    return rows;
  }

  private getDialogStrings(): DuplicateDialogStrings {
    return {
      header: getString("du-dialog-header"),
      titleColumn: getString("du-dialog-table-title"),
      asDefault: getString("du-dialog-as-default"),
      actions: {
        [Action.KEEP]: getString("du-dialog-table-keep"),
        [Action.DISCARD]: getString("du-dialog-table-discard"),
        [Action.CANCEL]: getString("du-dialog-table-cancel"),
      },
    };
  }

  private syncDuplicateDialogState(state: DuplicateDialogState) {
    state.rows.forEach((row) => {
      this.updateAction(row.groupID, row.action);
    });

    if (this.dialog?.dialogData) {
      this.dialog.dialogData.savePreference = state.savePreference;
      this.dialog.dialogData.defaultAction = state.defaultAction;
    }
  }

  private injectDialogStyles() {
    const doc = this.document;
    if (!doc || doc.getElementById("zoplicate-duplicates-dialog-stylesheet")) return;

    const stylesheet = doc.createElement("link");
    stylesheet.id = "zoplicate-duplicates-dialog-stylesheet";
    stylesheet.rel = "stylesheet";
    stylesheet.type = "text/css";
    stylesheet.href = `chrome://${config.addonRef}/content/duplicatesDialog.css`;
    doc.head.appendChild(stylesheet);
  }

  private scheduleDialogResize() {
    const win = this.dialogWindow as (Window & { sizeToContent?: () => void }) | undefined;
    if (!isWindowAlive(win) || !win.sizeToContent) return;
    setTimeout(() => win.sizeToContent?.(), 50);
    setTimeout(() => win.sizeToContent?.(), 350);
  }

  private getZoteroRequire(win?: Window): ((module: string) => unknown) | undefined {
    const candidates = [win, this.dialogWindow, this.resolveLiveWindow()];
    for (const candidate of candidates) {
      if (!isWindowAlive(candidate)) {
        continue;
      }
      const require = (candidate as Window & { require?: (module: string) => unknown }).require;
      if (require) {
        return require;
      }
    }

    try {
      return ztoolkit.getGlobal("require") as (module: string) => unknown;
    } catch (error) {
      ztoolkit.log("Dialog: failed to resolve Zotero module loader.", error);
      return undefined;
    }
  }

  private async renderDuplicateDialog() {
    const win = this.dialogWindow;
    const root = this.document?.getElementById("zoplicate-duplicates-dialog-root") as HTMLElement | null | undefined;
    if (!isWindowAlive(win) || !root) return;

    this.injectDialogStyles();

    const rows = await this.createDialogRows();
    const props: DuplicateDialogProps = {
      rows,
      version: ++this.duplicateDialogVersion,
      strings: this.getDialogStrings(),
      savePreference: Boolean(this.dialog?.dialogData?.savePreference),
      defaultAction: this.normalizeDialogAction(this.dialog?.dialogData?.defaultAction ?? Action.CANCEL),
      onStateChange: (state) => this.syncDuplicateDialogState(state),
    };

    if (this.duplicateDialogRenderer) {
      this.duplicateDialogRenderer.render(props);
    } else {
      const require = this.getZoteroRequire(win);
      if (!require) {
        ztoolkit.log("Dialog: Zotero React runtime is unavailable.");
        return;
      }
      try {
        const React = require("react") as typeof import("react");
        const ReactDOM = require("react-dom") as DuplicateDialogReactDOM;
        this.duplicateDialogRenderer = createDuplicatesDialogRenderer(React, ReactDOM, root, props);
      } catch (error) {
        ztoolkit.log("Dialog: failed to render duplicate dialog.", error);
        return;
      }
    }

    this.scheduleDialogResize();
  }

  private async createDialog() {
    const dialogData = {
      savePreference: false,
      defaultAction: Action.CANCEL,
      loadCallback: () => {
        void this.renderDuplicateDialog();
      },
      unloadCallback: () => {
        this.duplicateDialogRenderer?.unmount();
        this.duplicateDialogRenderer = undefined;
        this.duplicateDialogVersion = 0;
        if (this.dialog?.dialogData.savePreference) {
          setPref("duplicate.default.action", this.dialog?.dialogData.defaultAction);
        }
        this.dialog = undefined;
        ztoolkit.log("Dialog: unloaded");
        this.duplicateMaps = undefined;
      },
    };
    return new ztoolkit.Dialog(1, 1)
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "div",
        id: "zoplicate-duplicates-dialog-root",
        namespace: "html",
      })
      .addButton(getString("du-dialog-button-apply"), "btn_process", {
        callback: (e) => {
          this.processDuplicates(this.duplicateMaps!, { win: this.resolveLiveWindow() });
        },
      })
      .addButton(getString("du-dialog-button-go-duplicates"), "btn_go_duplicate", {
        callback: (e) => {
          const win = this.resolveLiveWindow();
          if (!win) {
            ztoolkit.log("Cannot go to duplicates pane because no live Zotero window is available.");
            return;
          }
          goToDuplicatesPane(win);
          bringToFront(win);
        },
      })
      .addButton(getString("general-cancel"), "btn_cancel");
  }

  private updateAction(groupID: number, action: Action) {
    const value = this.duplicateMaps?.get(groupID);
    if (value) {
      value.action = action;
      this.duplicateMaps?.set(groupID, value);
    }
  }
}
