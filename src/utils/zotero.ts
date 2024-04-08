export function goToDuplicatesPane(libraryID: number = ZoteroPane.getSelectedLibraryID()) {
  const type = "duplicates";
  const show = true;
  const select = true;
  // https://github.com/zotero/zotero/blob/main/chrome/content/zotero/zoteroPane.js#L1430C21
  ZoteroPane.setVirtual(libraryID, type, show, select);
}

export function refreshCollectionView() {
  ZoteroPane.collectionsView && ZoteroPane.collectionsView.tree.invalidate();
}

export function isInDuplicatesPane(index: number | undefined = undefined) {
  let collectionTreeRow;
  if (index !== undefined) {
    collectionTreeRow =
      ZoteroPane?.collectionsView && (ZoteroPane?.collectionsView.getRow(index) as Zotero.CollectionTreeRow);
  } else {
    collectionTreeRow = ZoteroPane?.getCollectionTreeRow();
  }
  return collectionTreeRow && collectionTreeRow.isDuplicates();
}
