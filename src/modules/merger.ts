export async function merge(
  masterItem: Zotero.Item,
  otherItems: Zotero.Item[], // Already sorted
): Promise<any> {
  Zotero.CollectionTreeCache.clear();

  const masterItemType = masterItem.itemTypeID;
  otherItems = otherItems.filter((item) => item.itemTypeID === masterItemType);
  if (otherItems.length === 0) {

    return;
  }

  const masterJSON = masterItem.toJSON();
  const candidateJSON: {
    [field in Zotero.Item.DataType]?: string | unknown;
  } = otherItems.reduce((acc, obj) => ({ ...acc, ...obj.toJSON() }), {});

  // Refer to https://github.com/zotero/zotero/blob/main/chrome/content/zotero/duplicatesMerge.js#L151
  // New link since 02/02/2024: https://github.com/zotero/zotero/blob/main/chrome/content/zotero/elements/duplicatesMergePane.js#L172
  // Exclude certain properties that are empty in the cloned object, so we don't clobber them
  const { relations, collections, tags, ...keep } = candidateJSON;

  masterItem.fromJSON({ ...keep, ...masterJSON });
  return await Zotero.Items.merge(masterItem, otherItems);
}
