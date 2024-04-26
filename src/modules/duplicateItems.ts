import { MasterItem } from "../utils/prefs";

/**
 * This class is used to store duplicate items.
 * All items in the array are the same item.
 */
export class DuplicateItems {
  get masterItem(): Zotero.Item {
    if (!this._masterItem) {
      this.analyze();
    }
    return this._masterItem!;
  }

  get items(): Zotero.Item[] {
    return this._items;
  }

  get itemTitle(): string {
    return this._items[0].getDisplayTitle();
  }

  private readonly _items: Zotero.Item[];
  private _masterItem: Zotero.Item | undefined;
  private readonly _masterItemPref: MasterItem;

  constructor(items: Zotero.Item[] | number[], masterItemPref: MasterItem) {
    this._masterItemPref = masterItemPref;
    this._items = items.map((item) => {
      if (typeof item === "number") {
        return Zotero.Items.get(item);
      }
      return item;
    });
  }

  private analyze() {
    let compare: (a: Zotero.Item, b: Zotero.Item) => number;
    switch (this._masterItemPref) {
      default:
      case MasterItem.OLDEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateAdded < b.dateAdded ? 1 : -1);
        break;
      case MasterItem.NEWEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateAdded > b.dateAdded ? 1 : -1);
        break;
      case MasterItem.MODIFIED:
        compare = (a: Zotero.Item, b: Zotero.Item) => (a.dateModified > b.dateModified ? 1 : -1);
        break;
      case MasterItem.DETAILED:
        compare = (a: Zotero.Item, b: Zotero.Item) => a.getUsedFields(false).length - b.getUsedFields(false).length;
        break;
    }
    this._items.sort(compare);
    this._masterItem = this._items.pop();
  }

  getOtherItems() {
    if (!this._masterItem) {
      this.analyze();
    }
    return this.items; // master item is already removed
  }
}
