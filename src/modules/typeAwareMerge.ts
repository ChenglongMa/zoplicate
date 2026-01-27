import { DialogHelper, TagElementProps } from "zotero-plugin-toolkit";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { fetchDuplicates } from "../utils/duplicates";
import { getPref, MasterItem } from "../utils/prefs";
import { DuplicateItems } from "./duplicateItems";
import { checkGuardrails, checkFastPath, ItemData, scoreTypes, selectMaster } from "./typeAwareMergeHelpers";
import { runSelfCheck } from "./typeAwareMerge.fixtures";

export class TypeAwareMerge {
  public static get instance(): TypeAwareMerge {
    if (!TypeAwareMerge._instance) {
      TypeAwareMerge._instance = new TypeAwareMerge();
    }
    return TypeAwareMerge._instance;
  }

  private static _instance: TypeAwareMerge;
  private constructor() { }



  public static readonly dryRunButtonID = "zoplicate-dry-run-button";
  public static readonly innerButtonID = this.dryRunButtonID + "-inner";
  public static readonly externalButtonID = this.dryRunButtonID + "-external";

  public static readonly dryRunAllButtonID = "zoplicate-dry-run-all-button";
  public static readonly innerDryRunAllButtonID = this.dryRunAllButtonID + "-inner";
  public static readonly externalDryRunAllButtonID = this.dryRunAllButtonID + "-external";

  private win: Window | undefined;

  public createDryRunButton(win: Window, id: string, showing = true): TagElementProps {
    this.win = win;
    return {
      tag: "button",
      id: id,
      attributes: {
        label: "Dry Run – Selected Duplicates",
        tooltiptext: "Run a Dry Run report on the currently selected duplicate items.",
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "command",
          listener: async (e) => {
            Zotero.debug("[Zoplicate] Dry Run (Selected) clicked");
            try {
              await this.runDryRunReport('selected');
            } catch (err) {
              Zotero.logError(err as any);
              Zotero.Prompt.confirm({
                window: this.win as any,
                title: "Error",
                text: "An error occurred during Dry Run: " + err,
                button0: "OK"
              });
            }
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public createDryRunAllButton(win: Window, id: string, showing = true): TagElementProps {
    this.win = win;
    return {
      tag: "button",
      id: id,
      attributes: {
        label: "Dry Run – All Duplicates",
        tooltiptext: "Run a Dry Run report on all duplicate items in the library.",
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "command",
          listener: async (e) => {
            Zotero.debug("[Zoplicate] Dry Run (All) clicked");
            try {
              await this.runDryRunReport('all');
            } catch (err) {
              Zotero.logError(err as any);
              Zotero.Prompt.confirm({
                window: this.win as any,
                title: "Error",
                text: "An error occurred during Dry Run: " + err,
                button0: "OK"
              });
            }
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  private getServices() {
    return (Zotero as any).Utilities.Internal.Services || (window as any).Services;
  }

  public async runDryRunReport(scope: 'selected' | 'first-5' | 'all') {
    // ensure errors bubble up to caller or are handled here if called directly (caller has try/catch too now)

    ztoolkit.log(`Starting Dry Run: Type-Aware Merge Report (Scope: ${scope})`);
    runSelfCheck(); // Run logic check on console start

    // 1. Fetch Duplicates
    const { duplicatesObj, duplicateItems } = await fetchDuplicates();

    // 2. Filter Clusters based on Scope
    let clustersToProcess: number[] = [];

    if (scope === 'all') {
      clustersToProcess = duplicateItems;
    } else if (scope === 'first-5') {
      clustersToProcess = duplicateItems.slice(0, 5);
    } else if (scope === 'selected') {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      const selectedIds = new Set(selectedItems.map(i => i.id));

      // Find clusters that contain any selected item
      // duplicateItems contains 'representative' item IDs for each cluster
      const relevantClusters = new Set<number>();

      for (const repId of duplicateItems) {
        const clusterItems = duplicatesObj.getSetItemsByItemID(repId);
        if (clusterItems.some(id => selectedIds.has(id))) {
          relevantClusters.add(repId);
        }
      }
      clustersToProcess = Array.from(relevantClusters);

      if (clustersToProcess.length === 0) {
        Zotero.Prompt.confirm({
          window: this.win as any,
          title: "No Duplicates Selected",
          text: "Your selection does not contain any known duplicate clusters.",
          button0: "OK"
        });
        return;
      }
    }

    ztoolkit.log(`Clusters to process: ${clustersToProcess.length}`);

    const processedItems: Set<number> = new Set();
    const report = {
      totalClusters: 0,
      mergeableClusters: 0,
      skippedClusters: 0,
      details: [] as any[],
      scope: scope
    };

    const popWin = new ztoolkit.ProgressWindow("Dry Run Report", {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: "Analyzing clusters...",
        type: "default",
        progress: 0,
      })
      .show();

    let clustersAnalyzed = 0;

    for (let i = 0; i < clustersToProcess.length; i++) {
      const duplicateItem = clustersToProcess[i];
      if (processedItems.has(duplicateItem)) continue;

      const items: number[] = duplicatesObj.getSetItemsByItemID(duplicateItem);
      if (items.length < 2) {
        processedItems.add(duplicateItem);
        continue;
      }

      // Mark all as processed
      items.forEach((id) => processedItems.add(id));

      clustersAnalyzed++;
      report.totalClusters++;

      popWin.changeLine({
        text: `Analyzing cluster ${clustersAnalyzed}...`,
        progress: Math.floor((i / clustersToProcess.length) * 100),
      });

      // Load Items
      const loadedItems = await Promise.all(items.map(id => Zotero.Items.getAsync(id)));

      // Analyze Logic
      const analysis = this.analyzeCluster(loadedItems);

      report.details.push({
        ids: items,
        analysis
      });

      if (analysis.action === "MERGE") {
        report.mergeableClusters++;
      } else {
        report.skippedClusters++;
      }

      // Yield to UI loop occasionally
      if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    ztoolkit.log("Dry Run Report Completed", report);
    Zotero.debug("Type-Aware Merge Dry Run Report: " + JSON.stringify(report, null, 2));

    popWin.changeLine({
      text: `Done! [${scope}] Mergeable: ${report.mergeableClusters}, Skipped: ${report.skippedClusters}. See Console.`,
      type: "success",
      progress: 100,
    });

    // popWin.startCloseTimer(50000);
    // Show Summary Dialog
    this.showDryRunSummary(report);
    popWin.close();
  }

  private showDryRunSummary(report: any) {
    const { totalClusters, mergeableClusters, skippedClusters, details, scope } = report;

    // 1. Calculate Breakdown
    const skipStats: Record<string, number> = {};
    for (const d of details) {
      if (d.analysis.action === "SKIP") {
        const code = d.analysis.skipCode || "UNKNOWN";
        skipStats[code] = (skipStats[code] || 0) + 1;
      }
    }

    // 2. Build Text
    const lines = [];
    lines.push(`DRY RUN REPORT (Scope: ${scope.toUpperCase()})`);
    lines.push("========================================");
    lines.push(`TOTAL CLUSTERS: ${totalClusters}`);
    lines.push(`MERGEABLE:      ${mergeableClusters}`);
    lines.push(`SKIPPED:        ${skippedClusters}`);
    lines.push("");
    lines.push("NOTICE: This was a dry run. No items were modified.");
    lines.push("");

    if (Object.keys(skipStats).length > 0) {
      lines.push("SKIPPED BREAKDOWN:");
      for (const [code, count] of Object.entries(skipStats)) {
        lines.push(` - ${code}: ${count}`);
      }
      lines.push("");
    }

    lines.push("DETAILS (First 50 Clusters):");
    lines.push("----------------------------------------");

    const limit = 50;
    for (let i = 0; i < Math.min(details.length, limit); i++) {
      const d = details[i];
      const action = d.analysis.action;
      const reason = d.analysis.reason;
      const type = d.analysis.type;
      lines.push(`[${action}] ${type} - ${reason}`);
    }
    if (details.length > limit) {
      lines.push(`... and ${details.length - limit} more.`);
    }

    // 3. Show Dialog (Restored using DialogHelper)
    const dialog = new DialogHelper(1, 1);
    dialog.addCell(0, 0, {
      tag: "div",
      namespace: "html",
      attributes: {
        style: "width: 100%; height: 100%; overflow: auto;"
      },
      children: [
        {
          tag: "pre",
          namespace: "html",
          properties: { textContent: lines.join("\n") },
          attributes: { style: "margin: 0; padding: 10px; white-space: pre-wrap; font-family: monospace;" }
        }
      ]
    });

    dialog.addButton("Close", "close");

    dialog.open("Dry Run Summary", {
      resizable: true,
      width: 600,
      height: 500,
      centerscreen: true
    });
  }

  public static readonly safeMergeButtonID = "zoplicate-safe-merge-button";
  public static readonly safeMergeInnerButtonID = this.safeMergeButtonID + "-inner";
  public static readonly safeMergeExternalButtonID = this.safeMergeButtonID + "-external";

  public static readonly safeMergeAllButtonID = "zoplicate-safe-merge-all-button";
  public static readonly innerSafeMergeAllButtonID = this.safeMergeAllButtonID + "-inner";
  public static readonly externalSafeMergeAllButtonID = this.safeMergeAllButtonID + "-external";

  public createSafeMergeButton(win: Window, id: string, showing = true): TagElementProps {
    this.win = win;
    return {
      tag: "button",
      id: id,
      attributes: {
        label: "Safe Merge – Selected Duplicates",
        tooltiptext: "Merge selected duplicate items using the safe merge strategy.",
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "command",
          listener: async (e) => {
            Zotero.debug("[Zoplicate] Safe Merge (Selected) clicked");
            try {
              await this.runSafeMerge('selected');
            } catch (err) {
              Zotero.logError(err as any);
              Zotero.Prompt.confirm({
                window: this.win as any,
                title: "Safe Merge Error",
                text: String(err),
                button0: "OK"
              });
            }
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public createSafeMergeAllButton(win: Window, id: string, showing = true): TagElementProps {
    this.win = win;
    return {
      tag: "button",
      id: id,
      attributes: {
        label: "Safe Merge – All Duplicates",
        tooltiptext: "Merge all duplicate items in the library using the safe merge strategy.",
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "command",
          listener: async (e) => {
            Zotero.debug("[Zoplicate] Safe Merge (All) clicked");
            try {
              await this.runSafeMerge('all');
            } catch (err) {
              Zotero.logError(err as any);
              Zotero.Prompt.confirm({
                window: this.win as any,
                title: "Safe Merge Error",
                text: String(err),
                button0: "OK"
              });
            }
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public async runSafeMerge(scope: 'selected' | 'first-5' | 'all') {
    // Confirmation Dialog with Scope info
    const confirm = Zotero.Prompt.confirm({
      window: this.win as any,
      title: "Type-Aware Merge (Safe)",
      text: `Scope: ${scope.toUpperCase()}\n\nThis will merge duplicates ONLY if they meet strict safety criteria (High Confidence, matching Strong IDs).\n\nItems will be converted to the canonical type before merging.\n\nProceed?`,
      button0: "Proceed",
      button1: "Cancel"
    });

    Zotero.debug(`[Zoplicate] Safe Merge Confirm Result: ${confirm} (Type: ${typeof confirm})`);

    // Zotero.Prompt.confirm with custom buttons returns the button index (0=Proceed, 1=Cancel)
    if (confirm !== 0) return; // Cancelled (or not Proceed)


    ztoolkit.log(`Starting Safe Merge (Scope: ${scope})`);
    const { duplicatesObj, duplicateItems } = await fetchDuplicates();

    // 2. Filter Clusters based on Scope
    let clustersToProcess: number[] = [];

    if (scope === 'all') {
      clustersToProcess = duplicateItems;
    } else if (scope === 'first-5') {
      clustersToProcess = duplicateItems.slice(0, 5);
    } else if (scope === 'selected') {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      const selectedIds = new Set(selectedItems.map(i => i.id));
      const relevantClusters = new Set<number>();

      for (const repId of duplicateItems) {
        const clusterItems = duplicatesObj.getSetItemsByItemID(repId);
        if (clusterItems.some(id => selectedIds.has(id))) {
          relevantClusters.add(repId);
        }
      }
      clustersToProcess = Array.from(relevantClusters);

      if (clustersToProcess.length === 0) {
        Zotero.Prompt.confirm({
          window: this.win as any,
          title: "No Duplicates Selected",
          text: "Your selection does not contain any known duplicate clusters.",
          button0: "OK"
        });
        return;
      }
    }

    const processedItems: Set<number> = new Set();
    const summary = {
      analyzed: 0,
      merged: 0,
      skipped: 0,
      errors: 0,
    };

    const popWin = new ztoolkit.ProgressWindow("Safe Merge Progress", {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: "Analyzing...",
        type: "default",
        progress: 0,
      })
      .show();

    for (let i = 0; i < clustersToProcess.length; i++) {
      const duplicateItem = clustersToProcess[i];
      if (processedItems.has(duplicateItem)) continue;

      const items: number[] = duplicatesObj.getSetItemsByItemID(duplicateItem);
      if (items.length < 2) {
        processedItems.add(duplicateItem);
        continue;
      }
      items.forEach((id) => processedItems.add(id));
      summary.analyzed++;

      popWin.changeLine({
        text: `Processing cluster ${summary.analyzed}...`,
        progress: Math.floor((i / clustersToProcess.length) * 100),
      });

      try {
        const loadedItems = await Promise.all(items.map(id => Zotero.Items.getAsync(id)));
        const analysis = this.analyzeCluster(loadedItems);

        // Criteria Check
        if (
          analysis.action === "MERGE" &&
          !analysis.skipCode &&
          analysis.confidence.score >= 6 &&
          analysis.confidence.margin >= 2
        ) {
          await this.normalizeAndMerge(loadedItems, analysis.type, analysis.suggestedMasterId);
          summary.merged++;
        } else {
          summary.skipped++;
          ztoolkit.log(`Skipped Cluster: ${analysis.reason}`, analysis);
        }

      } catch (e) {
        summary.errors++;
        ztoolkit.log("Error processing cluster", e);
      }

      // Yield
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    ztoolkit.log("Safe Merge Completed", summary);
    popWin.changeLine({
      text: `Done! [${scope}] Merged: ${summary.merged}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`,
      type: "success",
      progress: 100,
    });
    popWin.startCloseTimer(8000);
  }

  private async normalizeAndMerge(items: Zotero.Item[], targetTypeName: string, suggestedMasterId?: number) {
    const targetTypeId = Zotero.ItemTypes.getID(targetTypeName);

    // 1. Normalize Types
    if (targetTypeId === false) throw new Error(`Invalid type name: ${targetTypeName}`);

    for (const item of items) {
      if (item.itemTypeID !== targetTypeId) {
        item.setType(targetTypeId);
        await item.saveTx(); // Persist type change
      }
    }

    // 2. Refresh Items (ensure we have latest state after save)
    // Use suggested master or first item
    let masterItem: Zotero.Item | undefined;
    if (suggestedMasterId) {
      masterItem = items.find(i => i.id === suggestedMasterId);
    }
    if (!masterItem) masterItem = items[0];

    const otherItems = items.filter(i => i.id !== masterItem!.id);

    // 3. Call Merger
    // Dynamic import or keeping 'merge' usage from existing import
    const { merge } = require("./merger"); // Late bind or use top-level if safe
    await merge(masterItem, otherItems);
  }

  private analyzeCluster(items: Zotero.Item[]): {
    action: "MERGE" | "SKIP",
    reason: string,
    skipCode: string | null,
    evidence: string[],
    confidence: { score: number, margin: number },
    scoresByType?: Record<string, number>,
    type: string,
    suggestedMasterId?: number
  } {
    if (!items || items.length < 2) return {
      action: "SKIP",
      reason: "Single item",
      skipCode: "SINGLE_ITEM",
      evidence: [],
      confidence: { score: 0, margin: 0 },
      type: "n/a"
    };

    const itemData: ItemData[] = items.map(item => ({
      itemTypeID: item.itemTypeID,
      title: item.getField("title") as string,
      url: item.getField("url") as string,
      DOI: item.getField("DOI") as string,
      ISBN: item.getField("ISBN") as string,
      publicationTitle: item.getField("publicationTitle") as string,
      proceedingsTitle: item.getField("proceedingsTitle") as string,
      publisher: item.getField("publisher") as string,
      volume: item.getField("volume") as string,
      pages: item.getField("pages") as string,
      issue: item.getField("issue") as string,
      series: item.getField("series") as string,
      date: item.getField("date") as string,
      abstractNote: item.getField("abstractNote") as string,
      numAttachments: item.numAttachments(),
      id: item.id
    }));

    const typeNames = items.map(i => Zotero.ItemTypes.getName(i.itemTypeID));

    // 1. Guardrails
    const guard = checkGuardrails(itemData, typeNames);
    if (guard.actions === "SKIP") {
      return {
        action: "SKIP",
        reason: guard.reason || "Guardrail hit",
        skipCode: guard.skipCode || "GUARDRAIL",
        evidence: guard.evidence || [],
        confidence: { score: -1, margin: 0 },
        type: "mixed"
      };
    }

    // 2. Fast Path (Strong IDs)
    const fastPath = checkFastPath(itemData);
    if (fastPath.match) {
      const masterId = selectMaster(itemData);
      return {
        action: "MERGE",
        reason: fastPath.reason || "Fast Path Merge",
        skipCode: null,
        evidence: fastPath.evidence || [],
        confidence: fastPath.confidence || { score: 20, margin: 20 },
        type: fastPath.type || "unknown",
        suggestedMasterId: masterId
      };
    }

    // 3. Scoring
    const scoreCheck = scoreTypes(itemData, typeNames);

    // 3. Thresholds
    if (scoreCheck.topScore >= 6 && scoreCheck.margin >= 2) {
      const masterId = selectMaster(itemData);
      return {
        action: "MERGE",
        reason: `High confidence match (Score: ${scoreCheck.topScore}, Margin: +${scoreCheck.margin})`,
        skipCode: null,
        evidence: scoreCheck.evidence,
        confidence: { score: scoreCheck.topScore, margin: scoreCheck.margin },
        scoresByType: scoreCheck.scores,
        type: scoreCheck.topType,
        suggestedMasterId: masterId
      };
    }

    return {
      action: "SKIP",
      reason: `Ambiguous type results. Top candidate: ${scoreCheck.topType} (Score: ${scoreCheck.topScore})`,
      skipCode: "AMBIGUOUS_TYPE",
      evidence: scoreCheck.evidence,
      confidence: { score: scoreCheck.topScore, margin: scoreCheck.margin },
      scoresByType: scoreCheck.scores,
      type: scoreCheck.topType || "unknown"
    };
  }
}
