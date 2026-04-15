export function getZoteroPane(win: Window): _ZoteroTypes.ZoteroPane {
  return (win as any).ZoteroPane;
}

export function isWindowAlive(win?: Window | null): win is Window {
  if (!win || win.closed) {
    return false;
  }

  try {
    return !Components.utils.isDeadWrapper(win);
  } catch {
    return false;
  }
}

export function getWindowFromNode(node?: EventTarget | Node | null): Window | undefined {
  if (!node) {
    return undefined;
  }

  const doc =
    (node as Document).nodeType === 9
      ? (node as Document)
      : ((node as Node).ownerDocument ?? undefined);
  const win = doc?.defaultView;
  return isWindowAlive(win) ? win : undefined;
}

export function getWindowFromEvent(event?: Event): Window | undefined {
  return getWindowFromNode(event?.target ?? undefined);
}

export function getWindowFromMenuContext(
  context?: Pick<Zotero.MenuContext, "menuElem">,
  event?: Event,
): Window | undefined {
  return getWindowFromNode(context?.menuElem) ?? getWindowFromEvent(event);
}

export function getFirstLiveWindow(windows: Iterable<Window | undefined | null>): Window | undefined {
  for (const win of windows) {
    if (isWindowAlive(win)) {
      return win;
    }
  }
  return undefined;
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
