import { getPref, TypeMismatch, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";

async function convertItemType(item: Zotero.Item, targetTypeID: number) {
  await Zotero.DB.executeTransaction(async () => {
    item.setType(targetTypeID);
    await item.save();
    // Small delay to ensure DB operations complete
    await Zotero.Promise.delay(50);
  });
}

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
          savePreference: false,
          // Add promise to track dialog completion
          dialogPromise: Zotero.Promise.defer()
        })
        .addCell(0, 0, {
          tag: "p",
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
            if (dialog.dialogData.savePreference) {
              setPref("duplicate.type.mismatch", TypeMismatch.CONVERT);
            }
            dialog.dialogData.dialogPromise.resolve();
          }
        })
        .addButton(getString("type-mismatch-skip"), "btn_skip", {
          callback: () => {
            dialog.dialogData.action = TypeMismatch.SKIP;
            if (dialog.dialogData.savePreference) {
              setPref("duplicate.type.mismatch", TypeMismatch.SKIP);
            }
            dialog.dialogData.dialogPromise.resolve();
          }
        });

      dialog.open(getString("type-mismatch-title"), {
        centerscreen: true,
        resizable: true
      });

      // Wait for both dialog load and user action
      await dialog.dialogData.loadLock?.promise;
      await dialog.dialogData.dialogPromise.promise;

      if (dialog.dialogData.action === TypeMismatch.CONVERT) {
        // Convert items one by one
        for (const item of otherItems) {
          if (item.itemTypeID !== masterItemType) {
            await convertItemType(item, masterItemType);
          }
        }
      } else {
        otherItems = otherItems.filter(item => item.itemTypeID === masterItemType);
      }
    }
    else if (typeMismatchPref === TypeMismatch.CONVERT) {
      // Convert items one by one
      for (const item of otherItems) {
        if (item.itemTypeID !== masterItemType) {
          await convertItemType(item, masterItemType);
        }
      }
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