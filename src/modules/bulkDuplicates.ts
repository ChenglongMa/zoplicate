import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { getPref, MasterItem } from "../utils/prefs";
import { truncateString } from "../utils/utils";
import { updateDuplicateButtonsVisibilities } from "./duplicates";
import { merge } from "./merger";
import { isInDuplicatesPane, refreshItemTree } from "../utils/zotero";
import { DuplicateItems } from "./duplicateItems";
import { fetchDuplicates } from "../utils/duplicates";

export class BulkDuplicates {
  public static get instance(): BulkDuplicates {
    if (!BulkDuplicates._instance) {
      BulkDuplicates._instance = new BulkDuplicates();
    }
    return BulkDuplicates._instance;
  }

  private constructor() {}

  public static readonly bulkMergeButtonID = "zoplicate-bulk-merge-button";
  public static readonly innerButtonID = this.bulkMergeButtonID + "-inner";
  public static readonly externalButtonID = this.bulkMergeButtonID + "-external";
  private win: Window | undefined;
  private static _instance: BulkDuplicates;
  private _isRunning = false;
  public get isRunning(): boolean {
    return this._isRunning;
  }

  private set isRunning(value: boolean) {
    this._isRunning = value;
    const imageName = value ? "pause" : "merge";
    const label = value ? "bulk-merge-suspend" : "bulk-merge-title";
    this.getBulkMergeButtons(this.win!).forEach((button) => {
      button?.setAttribute("image", `chrome://${config.addonRef}/content/icons/${imageName}.svg`);
      button?.setAttribute("label", getString(label));
    });
    if (!value) {
      addon.data.needResetDuplicateSearch[ZoteroPane.getSelectedLibraryID()] = true;
      // Force refresh the duplicate item tree
      refreshItemTree();
    }
  }

  private getBulkMergeButtons(win: Window) {
    return [
      win.document.getElementById(BulkDuplicates.innerButtonID),
      win.document.getElementById(BulkDuplicates.externalButtonID),
    ];
  }

  public createBulkMergeButton(win: Window, id: string, showing = true): TagElementProps {
    return {
      tag: "button",
      id: id,
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
              this.isRunning = false;
              return;
            }

            const pref = getPref("bulk.master.item");
            const masterItem = getString(`bulk-merge-master-item-${pref}`);
            const text = `${getString("bulk-merge-message")}\n\n${getString("bulk-merge-sub-message", {
              args: { masterItem },
            })}\n${getString("bulk-merge-sub-message-2")}`;
            // https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prompt.js#L60
            // https://firefox-source-docs.mozilla.org/toolkit/components/prompts/prompts/nsIPromptService-reference.html#Prompter.confirmEx
            const result = Zotero.Prompt.confirm({
              window: win,
              title: getString("bulk-merge-title"),
              text: text,
              button0: Zotero.Prompt.BUTTON_TITLE_YES,
              button1: Zotero.Prompt.BUTTON_TITLE_CANCEL,
              checkLabel: "",
              checkbox: {},
            });
            if (result != 0) return;
            this.isRunning = true;
            await this.bulkMergeDuplicates();
            this.isRunning = false;
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  private async bulkMergeDuplicates() {
    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    const { duplicatesObj, duplicateItems } = await fetchDuplicates();
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
          window: this.win,
          title: getString("bulk-merge-suspend-title"),
          text: getString("bulk-merge-suspend-message"),
          button0: getString("bulk-merge-suspend-resume"),
          button1: getString("bulk-merge-suspend-cancel"),
          // button2: getString("bulk-merge-suspend-restore"),
          checkLabel: getString("bulk-merge-suspend-restore"),
          checkbox: restoreCheckbox,
        });
        if (result == 0) {
          restoreCheckbox.value = false;
          this.isRunning = true;
        } else {
          toCancel = true;
          break;
        }
      }
      const duplicateItem = duplicateItems[i];
      if (processedItems.has(duplicateItem)) continue;

      const items: number[] = duplicatesObj.getSetItemsByItemID(duplicateItem);
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

  registerUIElements(win: Window): void {
    this.win = win;
    ZoteroPane.collectionsView &&
      ZoteroPane.collectionsView.onSelect.addListener(async () => {
        const inDuplicatePane = isInDuplicatesPane();
        if (ZoteroPane.itemsView && inDuplicatePane && this._isRunning) {
          await ZoteroPane.itemsView.waitForLoad();
          ZoteroPane.itemsView.selection.clearSelection();
        }
      });

    ZoteroPane.itemsView &&
      ZoteroPane.itemsView.onRefresh.addListener(async () => {
        ztoolkit.log("refresh");
        const precondition = isInDuplicatesPane();
        if (precondition && ZoteroPane.itemsView && this._isRunning) {
          ZoteroPane.itemsView.selection.clearSelection();
        }
        await updateDuplicateButtonsVisibilities();
      });

    ZoteroPane.itemsView &&
      ZoteroPane.itemsView.onSelect.addListener(async () => {
        ztoolkit.log("itemsView.onSelect", ZoteroPane.getSelectedItems(true));
        // TODO: Further investigate the requirement of this
        // ZoteroPane.itemPane && ZoteroPane.itemPane.setAttribute("collapsed", "true");
        // TODO: Or this
        // if (ZoteroPane.itemPane) {
          // @ts-ignore
          // ZoteroPane.itemPane._itemDetails.skipRender = addon.data.processing;
          // ZoteroPane.itemPane._itemDetails.getPane("zotero-attachment-box")
          // const usePreview = Zotero.Prefs.get("showAttachmentPreview");
          // @ts-ignore
          // ZoteroPane.itemPane._itemDetails.getPane("attachments").usePreview =
          //   !addon.data.processing && usePreview;
        // }
        await updateDuplicateButtonsVisibilities();
      });
  }
}
