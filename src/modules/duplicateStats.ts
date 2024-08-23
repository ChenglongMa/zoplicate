import { config } from "../../package.json";
import { showingDuplicateStats } from "../utils/prefs";
import { getString } from "../utils/locale";
import { removeSiblings } from "../utils/view";
import CollectionTreeRow = Zotero.CollectionTreeRow;
import { fetchAllDuplicates } from "../utils/duplicates";

export async function registerDuplicateStats() {
  let showStats = showingDuplicateStats();

  if (showStats) {
    // Update duplicate statistics on startup
    await fetchAllDuplicates();
  }

  const patch = new ztoolkit.Patch();
  patch.setData({
    target: ZoteroPane.collectionsView,
    funcSign: "renderItem",
    // refer to https://github.com/zotero/zotero/blob/main/chrome/content/zotero/collectionTree.jsx#L274
    // i.e., the `renderItem` function of collectionTree
    patcher:
      (originalFunc: any) =>
        (index: number, selection: object, oldDiv: HTMLDivElement, columns: any[]): HTMLDivElement => {
          const originalDIV = originalFunc(index, selection, oldDiv, columns);
          showStats = showingDuplicateStats();
          if (!showStats) {
            originalDIV.removeAttribute("title");
            return originalDIV;
          }
          const collectionTreeRow =
            ZoteroPane?.collectionsView && (ZoteroPane?.collectionsView.getRow(index) as CollectionTreeRow);
          if (collectionTreeRow && collectionTreeRow.isDuplicates()) {
            const libraryID = collectionTreeRow.ref.libraryID.toString();
            const { total, unique } = addon.data.duplicateCounts[libraryID] ?? { total: 0, unique: 0 };
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
}

function getDuplicateStats(
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

export async function refreshDuplicateStats(
  libraryID: number,
  duplicatesObj: {
    getSetItemsByItemID(itemID: number): number[];
  },
  duplicateItems: number[],
) {
  if (!showingDuplicateStats()) return;

  const { total, unique } = getDuplicateStats(duplicatesObj, duplicateItems);
  addon.data.duplicateCounts[libraryID] = { total, unique };
}
