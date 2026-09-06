import { MasterItem } from "../prefs";

export interface LostFieldInfo {
  fieldName: string;
  fieldLabel: string;
  value: string | number;
  sourceItemTitle: string;
  sourceItemType: string;
  sourceItemID: number;
}

/**
 * Check if a field is valid for a given target item type, including
 * base-field conversions (e.g. publicationTitle <-> bookTitle via base 'title').
 */
export function isFieldValidForTargetType(
  fieldIDOrName: number | string,
  sourceTypeID: number,
  targetTypeID: number,
): boolean {
  if (sourceTypeID === targetTypeID) {
    return true;
  }

  const fieldID = typeof fieldIDOrName === "number" ? fieldIDOrName : Zotero.ItemFields.getID(fieldIDOrName);
  if (!fieldID) {
    return false;
  }

  // 1. Direct validity in target type
  if (Zotero.ItemFields.isValidForType(fieldID, targetTypeID)) {
    return true;
  }

  // 2. Base field conversion
  try {
    const baseID = Zotero.ItemFields.getBaseIDFromTypeAndField?.(sourceTypeID, fieldID);
    if (baseID) {
      const convertedFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase?.(targetTypeID, baseID);
      if (convertedFieldID) {
        return true;
      }
    }
  } catch {
    // If base conversion check is not available, rely on isValidForType
  }

  return false;
}

/**
 * Calculate all fields and values that would be lost if the merged result takes `targetTypeID`.
 */
export function calculateLostFieldsForType(items: Zotero.Item[], targetTypeID: number): LostFieldInfo[] {
  const lostFields: LostFieldInfo[] = [];

  for (const item of items) {
    if (item.itemTypeID === targetTypeID) {
      continue;
    }

    const usedFieldNames = item.getUsedFields(true) || [];
    for (const fieldName of usedFieldNames) {
      // Skip system or internal fields
      if (
        [
          "id",
          "key",
          "version",
          "itemType",
          "itemTypeID",
          "dateAdded",
          "dateModified",
          "deleted",
          "inPublications",
          "relations",
          "collections",
          "tags",
          "attachments",
          "notes",
          "accessDate",
        ].includes(fieldName)
      ) {
        continue;
      }

      const isValid = isFieldValidForTargetType(fieldName, item.itemTypeID, targetTypeID);
      if (!isValid) {
        const value = item.getField(fieldName);
        if (value !== undefined && value !== null && value !== "") {
          let fieldLabel = fieldName;
          try {
            const fieldID = Zotero.ItemFields.getID(fieldName);
            const localized = fieldID ? Zotero.ItemFields.getLocalizedString?.(fieldID) : undefined;
            if (localized) {
              fieldLabel = localized;
            }
          } catch {
            // Keep default fieldName
          }

          let sourceItemType = `Type ${item.itemTypeID}`;
          try {
            sourceItemType = Zotero.ItemTypes?.getName?.(item.itemTypeID) || sourceItemType;
          } catch {
            // ignore
          }

          lostFields.push({
            fieldName,
            fieldLabel,
            value,
            sourceItemTitle: item.getDisplayTitle?.() ?? `Item ${item.id}`,
            sourceItemType,
            sourceItemID: item.id,
          });
        }
      }
    }
  }

  return lostFields;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format the list of lost fields into an HTML note body.
 */
export function formatLostFieldsNote(lostFields: LostFieldInfo[]): string {
  if (lostFields.length === 0) {
    return "";
  }

  const itemsHtml = lostFields
    .map((lf) => {
      const field = escapeHtml(lf.fieldLabel || lf.fieldName);
      const val = escapeHtml(String(lf.value));
      const source = escapeHtml(`${lf.sourceItemTitle} (${lf.sourceItemType})`);
      return `<li><strong>${field}</strong>: ${val} <span style="color: #666; font-size: 0.9em;">[${source}]</span></li>`;
    })
    .join("\n");

  return (
    `<p><strong>Zoplicate — Champs non conservés lors de la fusion (types différents) :</strong></p>\n` +
    `<ul>\n${itemsHtml}\n</ul>`
  );
}

/**
 * Helper to compare items according to a master item preference.
 */
export function compareItemsByPref(a: Zotero.Item, b: Zotero.Item, pref: MasterItem): number {
  switch (pref) {
    case MasterItem.NEWEST:
      return b.dateAdded > a.dateAdded ? 1 : -1;
    case MasterItem.MODIFIED:
      return b.dateModified > a.dateModified ? 1 : -1;
    case MasterItem.DETAILED: {
      const fieldDiff = (b.getUsedFields(false)?.length ?? 0) - (a.getUsedFields(false)?.length ?? 0);
      if (fieldDiff !== 0) return fieldDiff;
      return b.dateAdded < a.dateAdded ? 1 : -1;
    }
    case MasterItem.OLDEST:
    default:
      return b.dateAdded < a.dateAdded ? 1 : -1;
  }
}

/**
 * Select the item type that minimizes lost fields, and pick the best master item
 * with that optimal type based on the user's master item preference.
 */
export function selectOptimalTypeAndMaster(
  items: Zotero.Item[],
  masterItemPref: MasterItem,
): { optimalTypeID: number; masterItem: Zotero.Item; lostFields: LostFieldInfo[] } {
  if (items.length === 0) {
    throw new Error("selectOptimalTypeAndMaster requires at least one item");
  }

  const candidateTypes = [...new Set(items.map((it) => it.itemTypeID))];

  if (candidateTypes.length === 1) {
    const sorted = [...items].sort((a, b) => compareItemsByPref(a, b, masterItemPref));
    return {
      optimalTypeID: candidateTypes[0],
      masterItem: sorted[0],
      lostFields: [],
    };
  }

  // Calculate lost fields for each candidate type
  const typeEvaluations = candidateTypes.map((typeID) => {
    const lostFields = calculateLostFieldsForType(items, typeID);
    const itemsOfType = items.filter((it) => it.itemTypeID === typeID);
    const bestItemForType = [...itemsOfType].sort((a, b) => compareItemsByPref(a, b, masterItemPref))[0];
    return {
      typeID,
      lostFields,
      lostCount: lostFields.length,
      bestItem: bestItemForType,
    };
  });

  // Sort by lowest lostCount, breaking ties using masterItemPref among bestItem candidates
  typeEvaluations.sort((a, b) => {
    if (a.lostCount !== b.lostCount) {
      return a.lostCount - b.lostCount;
    }
    return compareItemsByPref(a.bestItem, b.bestItem, masterItemPref);
  });

  const bestEval = typeEvaluations[0];
  return {
    optimalTypeID: bestEval.typeID,
    masterItem: bestEval.bestItem,
    lostFields: bestEval.lostFields,
  };
}
