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

export function refreshItemTree() {
  // NOTE: this function is async in the original code
  // but it will black the UI when it is called by `await`
  Zotero.ItemTreeManager._notifyItemTrees();
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

export function containsRegularItem(ids: number[] | string[]) {
  return Zotero.Items.get(ids).some((item) => {
    return item && item.library.libraryType != "feed" && item.isRegularItem();
  });
}

export function existsInLibrary(...ids: number[] | string[]) {
  return Zotero.Items.get(ids).every((item) => item && !item.deleted);
}

export function filterNonTrashedItems(...ids: number[] | string[]) {
  return Zotero.Items.get(ids).filter((item) => item && !item.deleted);
}

export function debug(...args: any[]) {
  Zotero.debug(
    "[zoplicate] " +
      args
        .map((d: any) => {
          try {
            return typeof d === "object" ? JSON.stringify(d) : String(d);
          } catch (e) {
            Zotero.debug(d);
            return "";
          }
        })
        .join("\n"),
  );
}
