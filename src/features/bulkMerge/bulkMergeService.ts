import type { TagElementProps } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { type Disposer } from "../../app/lifecycle";
import { markDuplicateSearchDirty } from "../../app/state";
import { fetchDuplicates } from "../../integrations/zotero/duplicateSearch";
import {
  getSelectedLibraryID,
  getZoteroPane,
  isInDuplicatesPane,
  refreshItemTree,
} from "../../integrations/zotero/windows";
import { getString } from "../../shared/locale";
import {
  BULK_MERGE_BUTTON_ID,
  BULK_MERGE_EXTERNAL_BUTTON_ID,
  BULK_MERGE_INNER_BUTTON_ID,
} from "../../shared/duplicates/duplicateButtonIDs";
import { DuplicateItems } from "../../shared/duplicates/duplicateItems";
import { merge } from "../../shared/duplicates/mergeItems";
import { getPref, MasterItem } from "../../shared/prefs";
import { truncateString } from "../../shared/utils";

export class BulkMergeController {
  public static readonly bulkMergeButtonID = BULK_MERGE_BUTTON_ID;
  public static readonly innerButtonID = BULK_MERGE_INNER_BUTTON_ID;
  public static readonly externalButtonID = BULK_MERGE_EXTERNAL_BUTTON_ID;

  private activeWindow: Window | undefined;
  private _isRunning = false;

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public createBulkMergeButton(win: Window, id: string, showing = true): TagElementProps {
    return {
      tag: "button",
      id,
      attributes: {
        label: getString("bulk-merge-title"),
        image: `chrome://${config.addonRef}/content/icons/merge.svg`,
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "click",
          listener: async (e) => {
            if ((e.target as HTMLInputElement).disabled) return;

            if (this._isRunning) {
              if (this.activeWindow === win) {
                this.setRunning(win, false);
              }
              return;
            }

            const pref = getPref("bulk.master.item");
            const masterItem = getString(`bulk-merge-master-item-${pref}`);
            const text = `${getString("bulk-merge-message")}\n\n${getString("bulk-merge-sub-message", {
              args: { masterItem },
            })}\n${getString("bulk-merge-sub-message-2")}`;
            const result = Zotero.Prompt.confirm({
              window: win,
              title: getString("bulk-merge-title"),
              text,
              button0: Zotero.Prompt.BUTTON_TITLE_YES,
              button1: Zotero.Prompt.BUTTON_TITLE_CANCEL,
              checkLabel: "",
              checkbox: {},
            });
            if (result != 0) return;

            this.setRunning(win, true);
            await this.bulkMergeDuplicates(win);
            this.setRunning(win, false);
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public registerUIElements(
    win: Window,
    updateDuplicateButtonsVisibilities: (win: Window) => Promise<void>,
  ): Disposer {
    const zoteroPane = getZoteroPane(win);

    const onCollectionSelect = async () => {
      if (zoteroPane.itemsView && isInDuplicatesPane(win) && this._isRunning) {
        await zoteroPane.itemsView?.waitForLoad();
        zoteroPane.itemsView?.selection.clearSelection();
      }
    };

    const onItemsRefresh = async () => {
      ztoolkit.log("refresh");
      if (isInDuplicatesPane(win) && zoteroPane.itemsView && this._isRunning) {
        zoteroPane.itemsView?.selection.clearSelection();
      }
      await updateDuplicateButtonsVisibilities(win);
    };

    const onItemsSelect = async () => {
      ztoolkit.log("itemsView.onSelect", zoteroPane.getSelectedItems(true));
      await updateDuplicateButtonsVisibilities(win);
    };

    const collectionsView = zoteroPane.collectionsView as any;
    const itemsView = zoteroPane.itemsView as any;

    collectionsView?.onSelect.addListener(onCollectionSelect);
    itemsView?.onRefresh.addListener(onItemsRefresh);
    itemsView?.onSelect.addListener(onItemsSelect);

    return () => {
      collectionsView?.onSelect.removeListener(onCollectionSelect);
      itemsView?.onRefresh.removeListener(onItemsRefresh);
      itemsView?.onSelect.removeListener(onItemsSelect);
    };
  }

  private setRunning(win: Window, value: boolean) {
    this._isRunning = value;
    this.activeWindow = value ? win : this.activeWindow;

    const imageName = value ? "pause" : "merge";
    const label = value ? "bulk-merge-suspend" : "bulk-merge-title";
    this.getBulkMergeButtons(win).forEach((button) => {
      button?.setAttribute("image", `chrome://${config.addonRef}/content/icons/${imageName}.svg`);
      button?.setAttribute("label", getString(label));
    });

    if (!value) {
      markDuplicateSearchDirty(getSelectedLibraryID(win));
      refreshItemTree(win);
      this.activeWindow = undefined;
    }
  }

  private getBulkMergeButtons(win: Window) {
    return [
      win.document.getElementById(BulkMergeController.innerButtonID),
      win.document.getElementById(BulkMergeController.externalButtonID),
    ];
  }

  private async bulkMergeDuplicates(win: Window) {
    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    const { duplicatesObj, duplicateItems } = await fetchDuplicates({
      libraryID: getSelectedLibraryID(win),
      refresh: false,
    });
    const processedItems: Set<number> = new Set();
    const popWin = new ztoolkit.ProgressWindow(getString("du-progress-text"), {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: getString("bulk-merge-popup-prepare"),
        type: "default",
        progress: 0,
      })
      .show();

    let toCancel = false;
    const deletedItems: Zotero.Item[] = [];
    let restoreCheckbox: { value: boolean } = { value: false };
    for (let i = 0; i < duplicateItems.length; i++) {
      if (!this._isRunning) {
        const result = Zotero.Prompt.confirm({
          window: win,
          title: getString("bulk-merge-suspend-title"),
          text: getString("bulk-merge-suspend-message"),
          button0: getString("bulk-merge-suspend-resume"),
          button1: getString("bulk-merge-suspend-cancel"),
          checkLabel: getString("bulk-merge-suspend-restore"),
          checkbox: restoreCheckbox,
        });
        if (result == 0) {
          restoreCheckbox.value = false;
          this.setRunning(win, true);
        } else {
          toCancel = true;
          break;
        }
      }
      const duplicateItem = duplicateItems[i];
      if (processedItems.has(duplicateItem)) continue;

      const items: number[] = duplicatesObj.getSetItemsByItemID(duplicateItem);
      if (items.length < 2) {
        processedItems.add(duplicateItem);
        continue;
      }
      const duItems = new DuplicateItems(items, masterItemPref);
      popWin.changeLine({
        text: getString("bulk-merge-popup-process", {
          args: { item: truncateString(duItems.itemTitle) },
        }),
        progress: Math.floor((i / duplicateItems.length) * 100),
      });
      const masterItem = duItems.masterItem;
      const otherItems = duItems.otherItems;
      await merge(masterItem, otherItems);
      deletedItems.push(...otherItems);
      items.forEach((id) => processedItems.add(id));
    }

    if (toCancel && restoreCheckbox.value) {
      const deletedCount = deletedItems.length;
      for (let i = deletedCount - 1; i >= 0; i--) {
        const item = deletedItems[i];
        item.deleted = false;
        await item.saveTx();
        popWin.changeLine({
          text: getString("bulk-merge-popup-restore", {
            args: { item: truncateString(item.getDisplayTitle()) },
          }),
          progress: Math.floor((i / deletedCount) * 100),
        });
      }
    }
    popWin.changeLine({
      text: getString("du-progress-done"),
      type: "success",
      progress: 100,
    });
    popWin.startCloseTimer(5000);
  }
}

export const bulkMergeController = new BulkMergeController();
