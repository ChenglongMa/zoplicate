import type { ProgressWindowHelper, TagElementProps } from "zotero-plugin-toolkit";
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

interface BulkMergeRun {
  id: number;
  win: Window;
  pauseRequested: boolean;
  finishing: boolean;
  progress?: ProgressWindowHelper;
}

export class BulkMergeController {
  public static readonly bulkMergeButtonID = BULK_MERGE_BUTTON_ID;
  public static readonly innerButtonID = BULK_MERGE_INNER_BUTTON_ID;
  public static readonly externalButtonID = BULK_MERGE_EXTERNAL_BUTTON_ID;

  private activeRun: BulkMergeRun | undefined;
  private nextRunID = 1;

  public get isRunning(): boolean {
    return Boolean(this.activeRun);
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

            if (this.activeRun) {
              if (this.activeRun.win === win) {
                this.requestSuspend(this.activeRun);
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

            const run = this.startRun(win);
            try {
              await this.bulkMergeDuplicates(run);
            } catch (error) {
              this.handleBulkMergeFailure(run, error);
            } finally {
              this.finishRun(run);
            }
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public registerUIElements(win: Window, updateDuplicateButtonsVisibilities: (win: Window) => Promise<void>): Disposer {
    const zoteroPane = getZoteroPane(win);

    const onCollectionSelect = async () => {
      if (zoteroPane.itemsView && isInDuplicatesPane(win) && this.isRunning) {
        await zoteroPane.itemsView?.waitForLoad();
        zoteroPane.itemsView?.selection.clearSelection();
      }
    };

    const onItemsRefresh = async () => {
      ztoolkit.log("refresh");
      if (isInDuplicatesPane(win) && zoteroPane.itemsView && this.isRunning) {
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

  private startRun(win: Window): BulkMergeRun {
    const run: BulkMergeRun = {
      id: this.nextRunID++,
      win,
      pauseRequested: false,
      finishing: false,
    };
    this.activeRun = run;
    this.setBulkMergeButtons(win, "bulk-merge-suspend", "pause", false);
    return run;
  }

  private requestSuspend(run: BulkMergeRun) {
    if (!this.isCurrentRun(run) || run.pauseRequested || run.finishing) return;
    run.pauseRequested = true;
    this.closeProgressWindow(run);
    this.setBulkMergeButtons(run.win, "bulk-merge-suspending", "pause", true);
    ztoolkit.log("Bulk merge suspend requested.", { runID: run.id });
  }

  private finishRun(run: BulkMergeRun) {
    if (!this.isCurrentRun(run)) return;
    run.finishing = true;
    this.setBulkMergeButtons(run.win, "bulk-merge-suspending", "pause", true);
    markDuplicateSearchDirty(getSelectedLibraryID(run.win));
    refreshItemTree(run.win);
    this.activeRun = undefined;
    this.setBulkMergeButtons(run.win, "bulk-merge-title", "merge", false);
  }

  private isCurrentRun(run: BulkMergeRun): boolean {
    return this.activeRun?.id === run.id;
  }

  private setBulkMergeButtons(win: Window, label: string, imageName: string, disabled: boolean) {
    this.getBulkMergeButtons(win).forEach((button) => {
      if (!button) return;
      button.setAttribute("image", `chrome://${config.addonRef}/content/icons/${imageName}.svg`);
      (button as HTMLElement & { label: string }).label = getString(label);
      (button as HTMLInputElement).disabled = disabled;
      if (disabled) {
        button.setAttribute("disabled", "true");
      } else {
        button.removeAttribute?.("disabled");
      }
    });
  }

  private getBulkMergeButtons(win: Window) {
    return [
      win.document.getElementById(BulkMergeController.innerButtonID),
      win.document.getElementById(BulkMergeController.externalButtonID),
    ];
  }

  private ensureProgressWindow(run: BulkMergeRun, text = getString("bulk-merge-popup-prepare")) {
    if (!this.isCurrentRun(run)) return undefined;
    if (run.progress) return run.progress;
    run.progress = new ztoolkit.ProgressWindow(getString("du-progress-text"), {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text,
        type: "default",
        progress: 0,
      })
      .show();
    return run.progress;
  }

  private closeProgressWindow(run: BulkMergeRun) {
    if (!run.progress) return;
    try {
      run.progress.close();
    } catch (error) {
      ztoolkit.log("Bulk merge: failed to close progress window.", error);
    }
    run.progress = undefined;
  }

  private changeProgressLine(run: BulkMergeRun, options: Parameters<ProgressWindowHelper["changeLine"]>[0]) {
    if (!this.isCurrentRun(run) || !run.progress) return;
    run.progress.changeLine(options);
  }

  private completeProgressWindow(run: BulkMergeRun) {
    const progress = this.ensureProgressWindow(run, getString("du-progress-done"));
    if (!progress) return;
    progress.changeLine({
      text: getString("du-progress-done"),
      type: "success",
      progress: 100,
    });
    progress.startCloseTimer(5000);
    run.progress = undefined;
  }

  private handleBulkMergeFailure(run: BulkMergeRun, error: unknown) {
    ztoolkit.log("Bulk merge failed.", error);
    const progress = this.ensureProgressWindow(run, getString("bulk-merge-popup-failed"));
    if (!progress) return;
    progress.changeLine({
      text: getString("bulk-merge-popup-failed"),
      type: "fail",
      progress: 100,
    });
    progress.startCloseTimer(5000);
    run.progress = undefined;
  }

  private async bulkMergeDuplicates(run: BulkMergeRun) {
    const win = run.win;
    const masterItemPref = getPref("bulk.master.item") as MasterItem;
    const { duplicatesObj, duplicateItems } = await fetchDuplicates({
      libraryID: getSelectedLibraryID(win),
      refresh: false,
    });
    const processedItems: Set<number> = new Set();
    this.ensureProgressWindow(run);

    let toCancel = false;
    const deletedItems: Zotero.Item[] = [];
    const restoreCheckbox: { value: boolean } = { value: false };
    for (let i = 0; i < duplicateItems.length; i++) {
      if (!this.isCurrentRun(run)) return;
      if (run.pauseRequested) {
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
          run.pauseRequested = false;
          restoreCheckbox.value = false;
          this.setBulkMergeButtons(win, "bulk-merge-suspend", "pause", false);
          this.ensureProgressWindow(run);
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
      this.changeProgressLine(run, {
        text: getString("bulk-merge-popup-process", {
          args: { item: truncateString(duItems.itemTitle) },
        }),
        progress: Math.floor((i / duplicateItems.length) * 100),
      });
      const masterItem = duItems.masterItem;
      const otherItems = duItems.otherItems;
      ztoolkit.log("Bulk merge: merging duplicate group.", {
        runID: run.id,
        itemIDs: items,
        title: duItems.itemTitle,
      });
      await merge(masterItem, otherItems);
      ztoolkit.log("Bulk merge: merged duplicate group.", {
        runID: run.id,
        itemIDs: items,
        title: duItems.itemTitle,
      });
      if (!this.isCurrentRun(run)) return;
      deletedItems.push(...otherItems);
      items.forEach((id) => processedItems.add(id));
    }

    if (toCancel && restoreCheckbox.value) {
      const deletedCount = deletedItems.length;
      this.ensureProgressWindow(run);
      for (let i = deletedCount - 1; i >= 0; i--) {
        if (!this.isCurrentRun(run)) return;
        const item = deletedItems[i];
        item.deleted = false;
        await item.saveTx();
        this.changeProgressLine(run, {
          text: getString("bulk-merge-popup-restore", {
            args: { item: truncateString(item.getDisplayTitle()) },
          }),
          progress: Math.floor((i / deletedCount) * 100),
        });
      }
    }

    if (toCancel && !restoreCheckbox.value) {
      this.closeProgressWindow(run);
      return;
    }
    this.completeProgressWindow(run);
  }
}

export const bulkMergeController = new BulkMergeController();
