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
