import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getPref, setPref, Action, MasterItem } from "../utils/prefs";
import { merge } from "./merger";
import CollectionTreeRow = Zotero.CollectionTreeRow;
import { removeSiblings } from "../utils/window";

/**
 * This class is used to store duplicate items.
 * All items in the array are the same item.
 */
export class DuplicateItems {
  get masterItem(): Zotero.Item {
    if (!this._masterItem) {
      this.analyze();
    }
    return this._masterItem!;
  }

  get items(): Zotero.Item[] {
    return this._items;
  }

  get itemTitle(): string {
    return this._items[0].getField("title");
  }

  private readonly _items: Zotero.Item[];
  private _masterItem: Zotero.Item | undefined;
  private readonly _masterItemPref: MasterItem;

  constructor(items: Zotero.Item[] | number[], masterItemPref: MasterItem) {
    this._masterItemPref = masterItemPref;
    this._items = items.map((item) => {
      if (typeof item === "number") {
        return Zotero.Items.get(item);
      }
      return item;
    });
  }

  private analyze() {
    let compare: (a: Zotero.Item, b: Zotero.Item) => number;
    switch (this._masterItemPref) {
      default:
      case MasterItem.OLDEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateAdded < b.dateAdded ? 1 : -1);
        break;
      case MasterItem.NEWEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateAdded > b.dateAdded ? 1 : -1);
        break;
      case MasterItem.MODIFIED:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateModified > b.dateModified ? 1 : -1);
        break;
      case MasterItem.DETAILED:
        compare = (a: Zotero.Item, b: Zotero.Item) => a.getUsedFields(false).length - b.getUsedFields(false).length;
        break;
    }
    this._items.sort(compare);
    this._masterItem = this._items.pop();
  }

  getOtherItems() {
    if (!this._masterItem) {
      this.analyze();
    }
    return this.items;
  }
}

export class Duplicates {
  constructor() {
    this.dialogData = addon.data.dialogs.dialog?.dialogData || {
      savePreference: false,
      defaultAction: Action.CANCEL,
      loadCallback: () => {
        const defaultActionOptions = this.document?.getElementById(
          `act_${this.dialogData.defaultAction}`,
        ) as HTMLInputElement;
        defaultActionOptions?.click();
        setTimeout(() => {
          const currentHeight = this.document?.getElementById("table_container")?.clientHeight || 0;
          if (currentHeight > 500) {
            (this.document?.getElementById("table_container") as HTMLElement).style.height = "500px";
            (this.window as any).sizeToContent();
            this.window?.resizeBy(20, 0); // Add 20px to width for scrollbar
          }
          ztoolkit.log("currentHeight: ", currentHeight);
        }, 500);
      },
      unloadCallback: () => {
        if (this.dialogData.savePreference) {
          setPref("duplicate.default.action", this.dialogData.defaultAction);
        }
        this.dialog = undefined;
        this.duplicateMaps = undefined;
      },
    };
  }

  static async refreshDuplicateStats(force: boolean = false) {
    if (!force && !addon.data.refreshDuplicateStats) return;
    // Update duplicate statistics on startup
    const allLibs = Zotero.Libraries.getAll();
    for (const lib of allLibs) {
      const libraryID = lib.libraryID;
      await addon.hooks.onItemsChanged(libraryID);
    }
    addon.data.refreshDuplicateStats = false;
  }

  static async registerDuplicateStats() {
    let showStats = getPref("duplicate.stats.enable") as boolean;

    if (showStats) {
      await this.refreshDuplicateStats();
    }

    const patch = new ztoolkit.Patch();
    patch.setData({
      target: ZoteroPane.collectionsView,
      funcSign: "renderItem",
      // refer to https://github.com/zotero/zotero/blob/main/chrome/content/zotero/collectionTree.jsx#L274
      // i.e., the `renderItem` function of collectionTree
      // @ts-ignore
      patcher:
        (originalFunc: (index: number, selection: object, oldDiv: HTMLDivElement, columns: any[]) => HTMLDivElement) =>
        (index: number, selection: object, oldDiv: HTMLDivElement, columns: any[]): HTMLDivElement => {
          const originalDIV = originalFunc(index, selection, oldDiv, columns);
          showStats = getPref("duplicate.stats.enable") as boolean;
          if (!showStats) {
            originalDIV.removeAttribute("title");
            return originalDIV;
          }
          const collectionTreeRow =
            ZoteroPane?.collectionsView && (ZoteroPane?.collectionsView.getRow(index) as CollectionTreeRow);
          if (collectionTreeRow && collectionTreeRow.isDuplicates()) {
            const libraryID = collectionTreeRow.ref.libraryID.toString();
            const total = getPref(`duplicate.count.total.${libraryID}`) || 0;
            const unique = getPref(`duplicate.count.unique.${libraryID}`) || 0;
            const text = `${unique}/${total}`;
            const tooltip = total
              ? getString("duplicate-tooltip", {
                  args: { unique, total, items: unique == 1 ? "item" : "items" },
                })
              : getString("duplicate-not-found-tooltip");
            originalDIV.setAttribute("title", tooltip);

            // https://github.com/zotero/zotero/blob/main/chrome/content/zotero/collectionTree.jsx#L321
            // https://github.com/MuiseDestiny/zotero-style/blob/master/src/modules/views.ts#L3279
            const cell = originalDIV.querySelector("span.cell.label.primary") as Element;
            const collectionNameSpan = cell.querySelector("span.cell-text") as Element;
            removeSiblings(collectionNameSpan);
            const numberNode = cell.querySelector(".number");
            if (numberNode) {
              numberNode.innerHTML = text;
            } else {
              ztoolkit.UI.appendElement(
                {
                  tag: "span",
                  classList: [config.addonRef],
                  styles: {
                    display: "inline-block",
                    flex: "1",
                  },
                },
                cell,
              );
              ztoolkit.UI.appendElement(
                {
                  tag: "span",
                  classList: [config.addonRef, "number"],
                  styles: {
                    marginRight: "6px",
                  },
                  properties: {
                    innerHTML: text,
                  },
                },
                cell,
              );
            }
          }
          return originalDIV;
        },
      enabled: true,
    });
    addon.data.renderItemPatcher = patch;
  }

  async showDuplicates(duplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
    this.updateDuplicateMaps(duplicateMaps);

    if (this.dialog) {
      // const prevScrollWidth = this.document?.body.scrollWidth || 0;
      // const prevScrollHeight = this.document?.body.scrollHeight || 0;
      // If dialog is already opened, update table
      const tableBody = await this.updateTable();
      const prevTableBody = this.document?.getElementById("table_body") as Element;
      ztoolkit.UI.replaceElement(tableBody, prevTableBody);

      this.resumeRadioCheckStatus();

      // const scrollWidth = this.document?.body.scrollWidth || 0;
      // const scrollHeight = this.document?.body.scrollHeight || 0;
      // this.window?.resizeBy(scrollWidth - prevScrollWidth, scrollHeight - prevScrollHeight);
      // Temporary solution: enlarge dialog size and then resize to content
      this.window?.resizeBy(100, 100);
      (this.window as any).sizeToContent();
    } else {
      // If dialog is not opened, create dialog
      this.dialog = await this.createDialog();
      this.dialog.open(getString("du-dialog-title"), {
        centerscreen: true,
        resizable: true,
        fitContent: true,
        noDialogMode: false,
        alwaysRaised: true,
      });
      await this.dialogData.unloadLock.promise;
    }
  }

  static async getDuplicates(libraryID = ZoteroPane.getSelectedLibraryID()): Promise<{
    libraryID: number;
    duplicatesObj: { getSetItemsByItemID(itemID: number): number[] };
    duplicateItems: number[];
  }> {
    const duplicatesObj = new Zotero.Duplicates(libraryID);
    const search = await duplicatesObj.getSearchObject();
    const duplicateItems: number[] = await search.search();
    return { libraryID, duplicatesObj, duplicateItems };
  }

  static duplicateStatistics(
    duplicatesObj: {
      getSetItemsByItemID(itemID: number): number[];
    },
    duplicateItems: number[],
  ) {
    const total = duplicateItems.length;
    const counted: Set<number> = new Set();
    let unique = 0;

    for (const itemID of duplicateItems) {
      if (counted.has(itemID)) continue;

      const duplicates = duplicatesObj.getSetItemsByItemID(itemID);
      duplicates.forEach((id) => counted.add(id));
      unique++;
    }

    return { total, unique };
  }

  static async processDuplicates(duplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
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

    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    for (const [newItemID, { existingItemIDs, action }] of duplicateMaps) {
      const newItem = Zotero.Items.get(newItemID);
      if (action === Action.KEEP) {
        items.push({
          masterItem: newItem,
          otherItems: existingItemIDs.map((id) => Zotero.Items.get(id)),
        });
      } else if (action === Action.DISCARD) {
        const duplicateItems = new DuplicateItems(existingItemIDs, masterItemPref);
        const masterItem = duplicateItems.masterItem;
        const otherItems = duplicateItems.getOtherItems();
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

  private readonly dialogData: { [key: string | number | symbol]: any };

  private get dialog(): DialogHelper | undefined {
    return addon.data.dialogs.dialog;
  }

  private set dialog(value: DialogHelper | undefined) {
    addon.data.dialogs.dialog = value;
  }

  private get duplicateMaps(): Map<number, { existingItemIDs: number[]; action: Action }> | undefined {
    return addon.data.dialogs.duplicateMaps;
  }

  private set duplicateMaps(value: Map<number, { existingItemIDs: number[]; action: Action }> | undefined) {
    addon.data.dialogs.duplicateMaps = value;
  }

  private get window(): Window | undefined {
    return this.dialog?.window;
  }

  private get document(): Document | undefined {
    return this.window?.document;
  }

  private get newItemIDs(): number[] {
    return Array.from(this.duplicateMaps?.keys() || []);
  }

  private updateDuplicateMaps(newDuplicateMaps: Map<number, { existingItemIDs: number[]; action: Action }>) {
    if (this.duplicateMaps) {
      newDuplicateMaps.forEach((value, key) => {
        value.action = this.duplicateMaps?.get(key)?.action || value.action;
        value.action = value.action === Action.ASK ? Action.CANCEL : value.action;
        this.duplicateMaps?.set(key, value);
      });
    } else {
      this.duplicateMaps = newDuplicateMaps;
    }
  }

  private resumeRadioCheckStatus() {
    const actionSet = new Set<Action>();
    this.duplicateMaps?.forEach((value, newItemID) => {
      const action = value.action;
      const id = `act_${action}_${newItemID}`;
      const radio = this.document?.getElementById(id) as HTMLInputElement;
      radio.checked = true;
      actionSet.add(action);
    });

    const selectAll = actionSet.size === 1;
    const [defaultAction] = actionSet;
    this.checkDefaultRadio(selectAll, defaultAction);
  }

  private checkDefaultRadio(selectAll: boolean, defaultAction: Action) {
    // Set disabled status of "as default" checkbox
    const asDefaultDiv = this.document?.getElementById("act_as_default_div");
    asDefaultDiv && (asDefaultDiv.style.visibility = selectAll ? "visible" : "hidden");

    if (selectAll) {
      // Update default action
      this.dialog?.dialogData && (this.dialog.dialogData.defaultAction = defaultAction);

      // Set radio of Column Header to checked
      const id = `act_${defaultAction}`;
      const radio = this.document?.getElementById(id) as HTMLInputElement;
      radio.checked = true;
    } else {
      // Set radio of Column Header to unchecked
      const asDefaultCheckbox = this.document?.getElementById("act_as_default") as HTMLInputElement;
      asDefaultCheckbox.checked = false;
      const allRadios = this.document?.getElementsByName("default_action") as NodeListOf<HTMLInputElement>;
      allRadios &&
        allRadios.forEach((radio) => {
          radio.checked = false;
        });
    }
  }

  private async createDialog() {
    const tableBody = await this.updateTable();
    return new ztoolkit.Dialog(3, 1)
      .setDialogData(this.dialogData)
      .addCell(0, 0, {
        tag: "h2",
        properties: { innerHTML: getString("du-dialog-header") },
      })
      .addCell(1, 0, {
        tag: "div",
        id: "table_container",
        namespace: "html",
        styles: {
          maxHeight: "500px",
          overflowY: "auto",
        },
        children: [
          {
            tag: "table",
            id: "data_table",
            namespace: "html",
            attributes: { border: "1" },
            styles: {
              borderCollapse: "collapse",
              textAlign: "center",
              whiteSpace: "nowrap",
            },
            children: [
              {
                tag: "thead",
                namespace: "html",
                children: [
                  {
                    tag: "tr",
                    namespace: "html",
                    children: [
                      {
                        tag: "th",
                        namespace: "html",
                        properties: {
                          innerHTML: getString("du-dialog-table-title"),
                        },
                      },
                      this.createTh(Action.KEEP),
                      this.createTh(Action.DISCARD),
                      this.createTh(Action.CANCEL),
                    ],
                  },
                ],
              },
              tableBody,
            ],
          },
        ],
      })
      .addCell(2, 0, {
        tag: "div",
        namespace: "html",
        id: "act_as_default_div",
        styles: {
          padding: "5px",
        },
        children: [
          {
            tag: "input",
            namespace: "html",
            id: "act_as_default",
            attributes: {
              "data-bind": "savePreference",
              "data-prop": "checked",
              type: "checkbox",
            },
          },
          {
            tag: "label",
            namespace: "html",
            attributes: {
              for: "act_as_default",
            },
            properties: { innerHTML: getString("du-dialog-as-default") },
          },
        ],
      })
      .addButton(getString("du-dialog-button-apply"), "btn_process", {
        callback: async (e) => {
          await Duplicates.processDuplicates(this.duplicateMaps!);
        },
      })
      .addButton(getString("du-dialog-button-go-duplicates"), "btn_go_duplicate", {
        callback: (e) => {
          const libraryID = ZoteroPane.getSelectedLibraryID();
          const type = "duplicates";
          const show = true;
          const select = true;
          // https://github.com/zotero/zotero/blob/main/chrome/content/zotero/zoteroPane.js#L1430C21
          ZoteroPane.setVirtual(libraryID, type, show, select);
        },
      })
      .addButton(getString("general-cancel"), "btn_cancel");
  }

  private async updateTable(): Promise<TagElementProps> {
    const tableRows = [];
    for (const [newItemID, { existingItemIDs }] of this.duplicateMaps || []) {
      if (existingItemIDs.length === 0) continue;
      const item = await Zotero.Items.getAsync(newItemID);
      const title = item.getField("title");

      tableRows.push({
        tag: "tr",
        namespace: "html",
        children: [
          {
            tag: "td",
            namespace: "html",
            styles: {
              maxWidth: "800px",
              minWidth: "500px",
              padding: "5px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "left",
            },
            properties: {
              innerHTML: title,
            },
          },
          this.createRadioTd(newItemID, Action.KEEP),
          this.createRadioTd(newItemID, Action.DISCARD),
          this.createRadioTd(newItemID, Action.CANCEL),
        ],
      });
    }
    return {
      tag: "tbody",
      id: "table_body",
      namespace: "html",
      children: tableRows,
    };
  }

  private updateAction(newItemID: number, action: Action) {
    const value = this.duplicateMaps?.get(newItemID);
    if (value) {
      value.action = action;
      this.duplicateMaps?.set(newItemID, value);
    }
  }

  private createRadioTd(newItemID: number, action: Action): TagElementProps {
    return {
      tag: "td",
      namespace: "html",
      styles: {
        padding: "5px",
      },
      children: [
        {
          tag: "input",
          namespace: "html",
          id: `act_${action}_${newItemID}`,
          attributes: {
            type: "radio",
            name: `action_${newItemID}`,
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                this.updateAction(newItemID, action);
                const selectAll = Array.from(this.duplicateMaps?.values() || []).every((i) => i.action === action);
                this.checkDefaultRadio(selectAll, action);
              },
            },
          ],
        },
      ],
      listeners: [
        {
          type: "click",
          listener: () => {
            // Click the cell to select the radio
            const id = `act_${action}_${newItemID}`;
            const radio = this.document?.getElementById(id) as HTMLInputElement;
            radio.click();
          },
        },
      ],
    };
  }

  private createTh(action: Action): TagElementProps {
    return {
      tag: "th",
      namespace: "html",
      styles: {
        padding: "5px",
        textAlign: "left",
        whiteSpace: "nowrap",
      },
      children: [
        {
          tag: "input",
          namespace: "html",
          id: `act_${action}`,
          attributes: {
            type: "radio",
            name: "default_action",
            value: action,
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                // Set all radio of this action to checked
                this.newItemIDs.forEach((newItemID) => {
                  const id = `act_${action}_${newItemID}`;
                  const radio = this.document?.getElementById(id) as HTMLInputElement;
                  !radio.checked && radio.click();
                });
              },
            },
          ],
        },
        {
          tag: "label",
          namespace: "html",
          attributes: {
            for: `act_${action}`,
          },
          properties: { innerHTML: getString(`du-dialog-table-${action}`) },
        },
      ],
    };
  }
}
