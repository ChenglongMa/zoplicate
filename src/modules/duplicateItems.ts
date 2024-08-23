import { MasterItem } from "../utils/prefs";

/**
 * This class is used to store duplicate items.
 * All items in the array should be duplicates of each other.
 */
export class DuplicateItems {
  private readonly _items: Zotero.Item[];
  private _masterItem: Zotero.Item | undefined;
  private _masterItemPref: MasterItem;
  private readonly _smallestItemID: number;
  private readonly _itemTitle: string;

  constructor(items: Zotero.Item[] | number[], masterItemPref: MasterItem) {
    if (items.length < 1) {
      throw new Error("DuplicateItems must have at least one item");
    }

    this._masterItemPref = masterItemPref;
    this._items = items.map((item) => (typeof item === "number" ? Zotero.Items.get(item) : item));
    this._smallestItemID = this._items.reduce((acc, item) => (item.id < acc ? item.id : acc), this._items[0].id);
    this._itemTitle = this._items[0].getDisplayTitle();
  }

  get masterItem(): Zotero.Item {
    if (!this._masterItem) {
      this.analyze();
    }
    return this._masterItem!;
  }

  get items(): Zotero.Item[] {
    return this._items;
  }

  get otherItems() {
    if (!this._masterItem) {
      this.analyze();
    }
    return this._items.slice(1);
  }

  get itemTitle(): string {
    return this._itemTitle;
  }

  /**
   * The group identifier of the duplicate items.
   */
  get key(): number {
    return this._smallestItemID;
  }

  set masterItemPref(pref: MasterItem) {
    this._masterItemPref = pref;
    this._masterItem = undefined;
  }

  private analyze() {
    let compare: (a: Zotero.Item, b: Zotero.Item) => number;
    switch (this._masterItemPref) {
      default:
      case MasterItem.OLDEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (b.dateAdded < a.dateAdded ? 1 : -1);
        break;
      case MasterItem.NEWEST:
        compare = (a: Zotero.Item, b: Zotero.Item) => (b.dateAdded > a.dateAdded ? 1 : -1);
        break;
      case MasterItem.MODIFIED:
        compare = (a: Zotero.Item, b: Zotero.Item) => (b.dateModified > a.dateModified ? 1 : -1);
        break;
      case MasterItem.DETAILED:
        compare = (a: Zotero.Item, b: Zotero.Item) => {
          const fieldDiff = b.getUsedFields(false).length - a.getUsedFields(false).length;
          if (fieldDiff !== 0) {
            return fieldDiff;
          }
          return b.dateAdded < a.dateAdded ? 1 : -1;
        };
        break;
    }
    this._items.sort(compare);
    this._masterItem = this._items[0];
  }
}
