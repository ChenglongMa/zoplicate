export function getZoteroPane(win: Window): _ZoteroTypes.ZoteroPane {
  return (win as any).ZoteroPane;
}

export function getCollectionsView(win: Window) {
  return getZoteroPane(win).collectionsView || undefined;
}

export function getItemsView(win: Window) {
  return getZoteroPane(win).itemsView || undefined;
}

export function getSelectedItems(win: Window): Zotero.Item[] {
  return getZoteroPane(win).getSelectedItems();
}

export function getSelectedLibraryID(win: Window): number {
  return getZoteroPane(win).getSelectedLibraryID();
}

export function goToDuplicatesPane(win: Window, libraryID: number = getSelectedLibraryID(win)) {
  getZoteroPane(win).setVirtual(libraryID, "duplicates", true, true);
}

export function refreshItemTree(_win?: Window) {
  // NOTE: Zotero.ItemTreeManager._notifyItemTrees() is async, but awaiting it can block the UI.
  Zotero.ItemTreeManager.refreshColumns();
}

export function isInDuplicatesPane(win: Window, index: number | undefined = undefined): boolean {
  const row =
    index !== undefined
      ? getCollectionsView(win)?.getRow(index)
      : getZoteroPane(win).getCollectionTreeRow();
  return row?.isDuplicates?.() ?? false;
}

export function getWindowFromEvent(event: Event): Window | undefined {
  return ((event.target as Node | null)?.ownerDocument?.defaultView ?? undefined) as Window | undefined;
}
