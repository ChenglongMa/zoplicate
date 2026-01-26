import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { fetchDuplicates } from "../utils/duplicates";
import { getPref, MasterItem } from "../utils/prefs";
import { DuplicateItems } from "./duplicateItems";
import { checkGuardrails, ItemData, scoreTypes, selectMaster } from "./typeAwareMergeHelpers";
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
  private win: Window | undefined;

  public createDryRunButton(win: Window, id: string, showing = true): TagElementProps {
    this.win = win;
    return {
      tag: "button",
      id: id,
      attributes: {
        label: "Dry Run: Type-Aware Merge Report",
        hidden: !showing,
      },
      namespace: "xul",
      listeners: [
        {
          type: "click",
          listener: async (e) => {
            this.runDryRunReport();
          },
        },
      ],
      ignoreIfExists: true,
    };
  }

  public async runDryRunReport() {
    ztoolkit.log("Starting Dry Run: Type-Aware Merge Report");
    runSelfCheck(); // Run logic check on console start

    // 1. Fetch Duplicates
    const { duplicatesObj, duplicateItems } = await fetchDuplicates();
    const processedItems: Set<number> = new Set();
    const report = {
      totalClusters: 0,
      mergeableClusters: 0,
      skippedClusters: 0,
      details: [] as any[]
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

    for (let i = 0; i < duplicateItems.length; i++) {
      const duplicateItem = duplicateItems[i];
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
        progress: Math.floor((i / duplicateItems.length) * 100),
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
    console.log("Type-Aware Merge Dry Run Report:", JSON.stringify(report, null, 2));

    popWin.changeLine({
      text: `Done! Mergeable: ${report.mergeableClusters}, Skipped: ${report.skippedClusters}. See Console for details.`,
      type: "success",
      progress: 100,
    });

    popWin.startCloseTimer(50000);
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

    // 2. Scoring
    const scoreCheck = scoreTypes(itemData, typeNames);

    // 3. Thresholds
    if (scoreCheck.topScore >= 6 && scoreCheck.margin >= 2) {
      const masterId = selectMaster(itemData);
      return {
        action: "MERGE",
        reason: `High confidence match (${scoreCheck.topScore}, +${scoreCheck.margin})`,
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
      reason: `Ambiguous type results. Top: ${scoreCheck.topType} (${scoreCheck.topScore})`,
      skipCode: "AMBIGUOUS_TYPE",
      evidence: scoreCheck.evidence,
      confidence: { score: scoreCheck.topScore, margin: scoreCheck.margin },
      scoresByType: scoreCheck.scores,
      type: scoreCheck.topType || "unknown"
    };
  }
}
