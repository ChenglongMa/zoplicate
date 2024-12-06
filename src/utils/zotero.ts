export function goToDuplicatesPane(libraryID: number = Zotero.getActiveZoteroPane().getSelectedLibraryID()) {
  const type = "duplicates";
  const show = true;
  const select = true;
  // https://github.com/zotero/zotero/blob/886dbd17ffd996a4cd42e5192695636d12edbfc3/chrome/content/zotero/zoteroPane.js#L2321
  Zotero.getActiveZoteroPane().setVirtual(libraryID, type, show, select);
}

export function activeCollectionsView() {
  return Zotero.getActiveZoteroPane().collectionsView || undefined;
}

export function activeItemsView() {
  return Zotero.getActiveZoteroPane().itemsView || undefined;
}

export function refreshCollectionView() {
  activeCollectionsView()?.tree.invalidate();
}

export function refreshItemTree() {
  // NOTE: this function is async in the original code
  // but it will black the UI when it is called by `await`
  // Zotero.ItemTreeManager._notifyItemTrees();
  Zotero.ItemTreeManager.refreshColumns();

  // NOTE: Source code of Zotero.ItemTreeManager._notifyItemTrees():
  //
  // async _notifyItemTrees() {
  //   await Zotero.DB.executeTransaction(async function () {
  //     Zotero.Notifier.queue(
  //       'refresh',
  //       'itemtree',
  //       [],
  //       {},
  //     );
  //   });
  // }
}

export function isInDuplicatesPane(index: number | undefined = undefined) {
  let collectionTreeRow;
  if (index !== undefined) {
    collectionTreeRow = activeCollectionsView()?.getRow(index);
  } else {
    collectionTreeRow = Zotero.getActiveZoteroPane().getCollectionTreeRow();
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
