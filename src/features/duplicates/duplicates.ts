import { config } from "../../../package.json";
import { getString } from "../../shared/locale";
import type { DialogHelper } from "zotero-plugin-toolkit";
import { Action, getPref, MasterItem, setPref } from "../../shared/prefs";
import { merge } from "../../shared/duplicates/mergeItems";
import { goToDuplicatesPane } from "../../integrations/zotero/windows";
import { DuplicateItems } from "../../shared/duplicates/duplicateItems";
import { bringToFront } from "../../integrations/zotero/windowChrome";
import { showHintWithLink } from "../../shared/utils";
import { waitUntilAsync } from "../../shared/wait";
import { getDialogs, setProcessing } from "../../app/state";
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

  async whenItemsAdded(
    duplicatesObj: {
      getSetItemsByItemID(itemID: number): number[];
    },
    ids: Array<number>,
  ) {
    const defaultAction = getPref("duplicate.default.action") as Action;
    if (defaultAction === Action.CANCEL || ids.length === 0) {
      return;
    }

    const duplicateItemMap = new Map<number, DuplicateItems>();
    for (const id of ids) {
      const items = duplicatesObj.getSetItemsByItemID(id);
      if (items.length < 2) {
        continue;
      }
      const duplicateItems = new DuplicateItems(items, getPref("bulk.master.item") as MasterItem);
      duplicateItemMap.set(duplicateItems.key, duplicateItems);
    }

    const duplicateMaps = ids.reduce((acc, id) => {
      const existingItemIDs: number[] = duplicatesObj.getSetItemsByItemID(id).filter((i: number) => i !== id);
      if (existingItemIDs.length > 0) {
        acc.set(id, { existingItemIDs, action: defaultAction });
      }
      return acc;
    }, new Map<number, { existingItemIDs: number[]; action: Action }>());

    if (duplicateMaps.size === 0) return;

    if (defaultAction === Action.ASK) {
      await this.showDuplicates(duplicateMaps);
      return;
    }
    this.processDuplicates(duplicateMaps).then((r) => {}); // DONT WAIT
  }

  async processDuplicates(duplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
    const items: { masterItem: Zotero.Item; otherItems: Zotero.Item[] }[] = [];
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
    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    for (const [newItemID, { existingItemIDs, action }] of duplicateMaps) {
      ztoolkit.log("Processing duplicate: ", newItemID);

      // TODO: Further check if the block is necessary
      try {
        // Wait for potential attachments to be downloaded
        await waitUntilAsync(() => Zotero.Items.get(newItemID).numAttachments() > 0, 1000, 5000);
      } catch (e) {
        ztoolkit.log(e);
      }

      const newItem = Zotero.Items.get(newItemID);
      if (action === Action.KEEP) {
        items.push({
          masterItem: newItem,
          otherItems: existingItemIDs.map((id) => Zotero.Items.get(id)),
        });
      } else if (action === Action.DISCARD) {
        if (existingItemIDs.length < 1) {
          continue;
        }
        const duplicateItems = new DuplicateItems(existingItemIDs, masterItemPref);
        const masterItem = duplicateItems.masterItem;
        const otherItems = duplicateItems.otherItems;
        items.push({
          masterItem: masterItem,
          otherItems: [...otherItems, newItem],
        });
      }
    }
    popWin.changeLine({
      text: getString("du-progress-text"),
      type: "default",
      progress: 30,
    });

    const selectedItemIDs = [];
    for (const { masterItem, otherItems } of items) {
      selectedItemIDs.push(masterItem.id);
      await merge(masterItem, otherItems);
    }
    setProcessing(false);

    popWin.changeLine({
      text: getString("du-progress-text"),
      type: "default",
      progress: 80,
    });

    Zotero.getActiveZoteroPane().selectItems(selectedItemIDs);

    popWin.changeLine({
      text: getString("du-progress-done"),
      type: "success",
      progress: 100,
    });
  }

  async showDuplicates(duplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
    this.updateDuplicateMaps(duplicateMaps);

    if (!this.document?.hasFocus()) {
      await showHintWithLink(config.addonName, getString("du-dialog-title"), getString("du-dialog-hint"), async () => {
        bringToFront(this.dialogWindow);
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

  private get duplicateMaps(): Map<number, { existingItemIDs: number[]; action: Action }> | undefined {
    return getDialogs().duplicateMaps;
  }

  private set duplicateMaps(value: Map<number, { existingItemIDs: number[]; action: Action }> | undefined) {
    getDialogs().duplicateMaps = value;
  }

  private get dialogWindow(): Window | undefined {
    return this.dialog?.window;
  }

  private get document(): Document | undefined {
    return this.dialogWindow?.document;
  }

  private updateDuplicateMaps(newDuplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
    const mergedMaps = new Map(this.duplicateMaps ?? []);
    ztoolkit.log("Update duplicate maps - old", this.duplicateMaps);
    ztoolkit.log("Update duplicate maps - new", newDuplicateMaps);

    newDuplicateMaps.forEach((value, key) => {
      if (value.existingItemIDs.length === 0) return;
      const previousAction = mergedMaps.get(key)?.action;
      mergedMaps.set(key, {
        existingItemIDs: value.existingItemIDs,
        action: this.normalizeDialogAction(previousAction ?? value.action),
      });
    });

    this.duplicateMaps = mergedMaps;
  }

  private normalizeDialogAction(action: Action): DuplicateDialogAction {
    return action === Action.ASK ? Action.CANCEL : (action as DuplicateDialogAction);
  }

  private async createDialogRows(): Promise<DuplicateDialogRow[]> {
    const rows: DuplicateDialogRow[] = [];
    for (const [newItemID, { existingItemIDs, action }] of this.duplicateMaps || []) {
      if (existingItemIDs.length === 0) continue;
      const item = await Zotero.Items.getAsync(newItemID);
      rows.push({
        newItemID,
        existingItemIDs,
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
      this.updateAction(row.newItemID, row.action);
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
    if (!win?.sizeToContent) return;
    setTimeout(() => win.sizeToContent?.(), 50);
    setTimeout(() => win.sizeToContent?.(), 350);
  }

  private getZoteroRequire(win?: Window): ((module: string) => unknown) | undefined {
    const dialogRequire = (win as (Window & { require?: (module: string) => unknown }) | undefined)?.require;
    if (dialogRequire) return dialogRequire;

    const mainWindowRequire = (Zotero.getMainWindow() as Window & { require?: (module: string) => unknown })?.require;
    if (mainWindowRequire) return mainWindowRequire;

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
    if (!win || !root) return;

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
          this.processDuplicates(this.duplicateMaps!);
        },
      })
      .addButton(getString("du-dialog-button-go-duplicates"), "btn_go_duplicate", {
        callback: (e) => {
          const win = Zotero.getMainWindow();
          goToDuplicatesPane(win);
        },
      })
      .addButton(getString("general-cancel"), "btn_cancel");
  }

  private updateAction(newItemID: number, action: Action) {
    const value = this.duplicateMaps?.get(newItemID);
    if (value) {
      value.action = action;
      this.duplicateMaps?.set(newItemID, value);
    }
  }
}
