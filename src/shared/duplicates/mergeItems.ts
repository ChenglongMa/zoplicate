import { mergeDifferentTypesEnabled } from "../prefs";
import { calculateLostFieldsForType, formatLostFieldsNote, isFieldValidForTargetType } from "./typeLossOptimizer";

export async function merge(
  masterItem: Zotero.Item,
  otherItems: Zotero.Item[], // Already sorted
): Promise<any> {
  // Zotero 10 replaced the global CollectionTreeCache with per-row caches
  // that are invalidated by the item-tree refresh cycle. Keep the explicit
  // clear for Zotero 9 without requiring the removed global on Zotero 10.
  Zotero.CollectionTreeCache?.clear?.();

  const allowDifferentTypes = mergeDifferentTypesEnabled();
  const masterItemType = masterItem.itemTypeID;

  if (!allowDifferentTypes) {
    otherItems = otherItems.filter((item) => item.itemTypeID === masterItemType);
  }

  if (otherItems.length === 0) {
    return;
  }

  // Calculate lost fields before merging if cross-type merging is enabled
  const lostFields = allowDifferentTypes ? calculateLostFieldsForType(otherItems, masterItemType) : [];

  const masterJSON = masterItem.toJSON();
  const candidateJSON: {
    [field in _ZoteroTypes.Item.DataType]?: string | unknown;
  } = otherItems.reduce((acc, obj) => ({ ...acc, ...obj.toJSON() }), {});

  // Refer to https://github.com/zotero/zotero/blob/main/chrome/content/zotero/duplicatesMerge.js#L151
  // New link since 02/02/2024: https://github.com/zotero/zotero/blob/main/chrome/content/zotero/elements/duplicatesMergePane.js#L172
  // Exclude certain properties that are empty in the cloned object, so we don't clobber them
  const { relations, collections, tags, ...keep } = candidateJSON;

  // If different types are enabled, only copy fields that are valid for the master's type
  let filteredKeep = keep;
  if (allowDifferentTypes) {
    filteredKeep = {};
    for (const [key, value] of Object.entries(keep)) {
      if (isFieldValidForTargetType(key, masterItemType, masterItemType)) {
        (filteredKeep as any)[key] = value;
      }
    }
  }

  masterItem.fromJSON({ ...filteredKeep, ...masterJSON });

  // ChromeUtils.importESModule is synchronous in Gecko -- do not await the import call
  const { mergeItems } = ChromeUtils.importESModule("chrome://zotero/content/mergeItems.mjs");
  const result = await mergeItems(masterItem, otherItems);

  // If there were lost fields from different item types, create a child note on masterItem
  if (lostFields.length > 0) {
    try {
      const noteContent = formatLostFieldsNote(lostFields);
      if (typeof (Zotero as any).Item === "function") {
        const noteItem = new (Zotero as any).Item("note");
        noteItem.libraryID = masterItem.libraryID;
        noteItem.parentItemID = masterItem.id;
        noteItem.setNote(noteContent);
        if (typeof noteItem.saveTx === "function") {
          await noteItem.saveTx();
        } else if (typeof noteItem.save === "function") {
          await noteItem.save();
        }
      }
    } catch (e) {
      ztoolkit?.log?.("Zoplicate: error creating lost fields note:", e);
    }
  }

  return result;
}
