/**
 * Get or refresh duplicates DB for the selected library
 * @param libraryID Library ID
 * @param refresh Whether to refresh the search, default is false
 */
export async function fetchDuplicates({
                                        libraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID(),
                                        refresh = false,
                                      } = {}): Promise<{
  libraryID: number;
  duplicatesObj: { getSetItemsByItemID(itemID: number): number[] };
  duplicateItems: number[];
}> {
  if (refresh) {
    addon.data.needResetDuplicateSearch[libraryID] = true;
  }
  const duplicatesObj = new Zotero.Duplicates(libraryID);
  const search = await duplicatesObj.getSearchObject();
  const duplicateItems: number[] = await search.search();
  return { libraryID, duplicatesObj, duplicateItems };
}


/**
 * @deprecated
 * Find the retained duplicate of the deleted item
 * @param deletedItem
 */
export async function findRetainedDuplicate(deletedItem: Zotero.Item | number) {
  const item = typeof deletedItem === "number" ? Zotero.Items.get(deletedItem) : deletedItem;
  const libraryID = item.libraryID;
  const { duplicatesObj } = await fetchDuplicates({ libraryID, refresh: false });
  const duplicates = duplicatesObj.getSetItemsByItemID(item.id);
  return duplicates.map((id) => Zotero.Items.get(id)).find((item) => !item.deleted);
}

export async function areDuplicates(items: number[] | Zotero.Item[] = Zotero.getActiveZoteroPane().getSelectedItems()) {
  if (items.length < 2) return false;
  const libraryIDs = new Set(
    items.map((item) => (typeof item === "number" ? Zotero.Items.get(item).libraryID : item.libraryID)),
  );

  if (libraryIDs.size > 1) return false;
  const { duplicatesObj } = await fetchDuplicates({ refresh: false });
  const itemIDs = items.map((item) => (typeof item === "number" ? item : item.id));
  const oneItem = itemIDs[0];
  const duplicateSets = new Set(duplicatesObj.getSetItemsByItemID(oneItem));
  return itemIDs.every((itemID) => duplicateSets.has(itemID));
}

export async function fetchAllDuplicates(refresh = false) {
  const libraries = Zotero.Libraries.getAll();
  for (const library of libraries) {
    const libraryType = library.libraryType;
    if (libraryType == "feed") continue;
    await fetchDuplicates({ libraryID: library.libraryID, refresh });
  }
}
