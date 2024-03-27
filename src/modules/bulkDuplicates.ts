import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { getPref, MasterItem } from "../utils/prefs";
import { truncateString } from "../utils/utils";
import { DuplicateItems, Duplicates } from "./duplicates";
import { merge } from "./merger";

export class BulkDuplicates {
  static getInstance(): BulkDuplicates {
    if (!BulkDuplicates.instance) {
      BulkDuplicates.instance = new BulkDuplicates();
    }
    return BulkDuplicates.instance;
  }

  private constructor() {}

  private bulkMergeButtonID = "zoplicate-bulk-merge-button";
  private innerButtonID = this.bulkMergeButtonID + "-inner";
  private externalButtonID = this.bulkMergeButtonID + "-external";
  private win: Window | undefined;
  private static instance: BulkDuplicates;
  private _isRunning = false;
  private set isRunning(value: boolean) {
    this._isRunning = value;
    const imageName = value ? "pause" : "merge";
    const label = value ? "bulk-merge-suspend" : "bulk-merge-title";
    this.getBulkMergeButtons(this.win!).forEach((button) => {
      button?.setAttribute("image", `chrome://${config.addonRef}/content/icons/${imageName}.svg`);
      button?.setAttribute("label", getString(label));
    });
  }

  private getBulkMergeButtons(win: Window) {
    return [win.document.getElementById(this.innerButtonID), win.document.getElementById(this.externalButtonID)];
  }

  private createBulkMergeButton(win: Window, id: string): TagElementProps {
    return {
      tag: "button",
      id: id,
      attributes: {
        label: getString("bulk-merge-title"),
        image: `chrome://${config.addonRef}/content/icons/merge.svg`,
      },
      classList: ["merge-button"],
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

  private updateButtonDisabled(win: Window, disabled: boolean, ...ids: string[]) {
    ids.forEach((id) => {
      const button = win.document.getElementById(id);
      if (button) {
        button.setAttribute("disabled", disabled.toString());
      }
    });
  }

  private async bulkMergeDuplicates() {
    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    const { duplicatesObj, duplicateItems } = await Duplicates.getDuplicates();
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
      const otherItems = duItems.getOtherItems();
      await merge(masterItem, otherItems);
      deletedItems.push(...otherItems);
      items.forEach((id) => processedItems.add(id));
    }

    if (toCancel && restoreCheckbox.value) {
      for (let i = deletedItems.length - 1; i >= 0; i--) {
        const item = deletedItems[i];
        item.deleted = false;
        await item.saveTx();
        popWin.changeLine({
          text: getString("bulk-merge-popup-restore", {
            args: { item: truncateString(item.getField("title")) },
          }),
          progress: Math.floor((i / deletedItems.length) * 100),
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
    const msgID = "zoplicate-bulk-merge-message";
    const msgVBox: TagElementProps = {
      tag: "vbox",
      id: msgID,
      properties: {
        textContent: getString("duplicate-panel-message"),
      },
      ignoreIfExists: true,
    };

    ZoteroPane.collectionsView &&
      ZoteroPane.collectionsView.onSelect.addListener(async () => {
        const mergeButton = win.document.getElementById("zotero-duplicates-merge-button") as Element;
        const groupBox = win.document.getElementById("zotero-item-pane-groupbox") as Element;
        const collectionTree = Zotero.getActiveZoteroPane()?.getCollectionTreeRow();
        if (collectionTree?.isDuplicates()) {
          ztoolkit.UI.appendElement(msgVBox, groupBox);
          ztoolkit.UI.insertElementBefore(this.createBulkMergeButton(win, this.innerButtonID), mergeButton);
          ztoolkit.UI.appendElement(this.createBulkMergeButton(win, this.externalButtonID), groupBox);
          if (ZoteroPane.itemsView) {
            await ZoteroPane.itemsView.waitForLoad();
            const disabled = ZoteroPane.itemsView.rowCount <= 0;
            this.updateButtonDisabled(win, disabled, this.innerButtonID, this.externalButtonID);
            if (this._isRunning) {
              ZoteroPane.itemsView.selection.clearSelection();
            }
          }
        } else {
          const externalButton = win.document.getElementById(this.externalButtonID);
          if (externalButton) {
            mergeButton.parentNode?.removeChild(win.document.getElementById(this.innerButtonID)!);
            groupBox.removeChild(win.document.getElementById(msgID)!);
            groupBox.removeChild(externalButton);
          }
        }
      });
  }
}
