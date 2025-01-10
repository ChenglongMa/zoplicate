import { getPref, TypeMismatch, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";

export async function merge(
  masterItem: Zotero.Item,
  otherItems: Zotero.Item[], // Already sorted
): Promise<any> {
  Zotero.CollectionTreeCache.clear();

  const masterItemType = masterItem.itemTypeID;
  // Check if any items need type conversion
  const hasMismatch = otherItems.some(item => item.itemTypeID !== masterItemType);

  if (hasMismatch) {
    const typeMismatchPref = getPref("duplicate.type.mismatch") as TypeMismatch;

    if (typeMismatchPref === TypeMismatch.ASK) {
      const dialog = new ztoolkit.Dialog(3, 1)
        .setDialogData({
          action: TypeMismatch.SKIP,
          savePreference: false  // This controls if we save preference permanently
        })
        .addCell(0, 0, {
          tag: "h2",
          properties: { innerHTML: getString("type-mismatch-message") }
        })
        .addCell(1, 0, {
          tag: "div",
          children: [
            {
              tag: "input",
              id: "save_pref",
              attributes: {
                type: "checkbox",
                "data-bind": "savePreference",
                "data-prop": "checked"
              }
            },
            {
              tag: "label",
              attributes: { for: "save_pref" },
              properties: { innerHTML: getString("du-dialog-as-default") }
            }
          ]
        })
        .addButton(getString("type-mismatch-convert"), "btn_convert", {
          callback: () => {
            dialog.dialogData.action = TypeMismatch.CONVERT;
            // Only save preference if user checked the box
            if (dialog.dialogData.savePreference) {
              setPref("duplicate.type.mismatch", TypeMismatch.CONVERT);
            }
          }
        })
        .addButton(getString("type-mismatch-skip"), "btn_skip", {
          callback: () => {
            dialog.dialogData.action = TypeMismatch.SKIP;
            // Only save preference if user checked the box
            if (dialog.dialogData.savePreference) {
              setPref("duplicate.type.mismatch", TypeMismatch.SKIP);
            }
          }
        });

      // Remove loadCallback and unloadCallback since we handle preference in button callbacks

      dialog.open(getString("type-mismatch-title"), {
        centerscreen: true,
        resizable: true
      });

      await dialog.dialogData.loadLock?.promise;

      if (dialog.dialogData.action === TypeMismatch.CONVERT) {
        // Convert all mismatched items in place
        await Promise.all(otherItems.map(async item => {
          if (item.itemTypeID !== masterItemType) {
            item.setType(masterItemType);  // Remove await since setType handles its own state
          }
        }));
      } else {
        otherItems = otherItems.filter(item => item.itemTypeID === masterItemType);
      }
    }
    else if (typeMismatchPref === TypeMismatch.CONVERT) {
      // Convert all mismatched items in place
      await Promise.all(otherItems.map(async item => {
        if (item.itemTypeID !== masterItemType) {
          item.setType(masterItemType);  // Remove await since setType handles its own state
        }
      }));
      otherItems = otherItems.filter(item => item.itemTypeID === masterItemType);
    }
    else { // TypeMismatch.SKIP
      otherItems = otherItems.filter(item => item.itemTypeID === masterItemType);
    }
  }

  if (otherItems.length === 0) return;

  const masterJSON = masterItem.toJSON();
  const candidateJSON: {
    //[field in Zotero.Item.DataType]?: string | unknown;
    [field in _ZoteroTypes.Item.DataType]?: string | unknown;
  } = otherItems.reduce((acc, obj) => ({ ...acc, ...obj.toJSON() }), {});
  // Refer to https://github.com/zotero/zotero/blob/main/chrome/content/zotero/duplicatesMerge.js#L151
  // New link since 02/02/2024: https://github.com/zotero/zotero/blob/main/chrome/content/zotero/elements/duplicatesMergePane.js#L172
  // Exclude certain properties that are empty in the cloned object, so we don't clobber them
  const { relations, collections, tags, ...keep } = candidateJSON;
  masterItem.fromJSON({ ...keep, ...masterJSON });

  return await Zotero.Items.merge(masterItem, otherItems);
}