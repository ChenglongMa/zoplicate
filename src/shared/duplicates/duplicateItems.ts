import { MasterItem, mergeDifferentTypesEnabled } from "../prefs";
import { compareItemsByPref, selectOptimalTypeAndMaster } from "./typeLossOptimizer";

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
    this._items = items
      .map((item) => (typeof item === "number" ? Zotero.Items.get(item) : item))
      .filter((item): item is Zotero.Item => Boolean(item));
    if (this._items.length < 1) {
      ztoolkit.log("DuplicateItems must have at least one item");
      throw new Error("DuplicateItems requires at least one available item");
    }

    this._masterItemPref = masterItemPref;
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
    const hasDifferentTypes = new Set(this._items.map((item) => item.itemTypeID)).size > 1;

    if (mergeDifferentTypesEnabled() && hasDifferentTypes) {
      const { masterItem } = selectOptimalTypeAndMaster(this._items, this._masterItemPref);
      this._masterItem = masterItem;
      // Re-order _items so that masterItem is at index 0, followed by other items sorted by preference
      const others = this._items
        .filter((it) => it.id !== masterItem.id)
        .sort((a, b) => compareItemsByPref(a, b, this._masterItemPref));
      this._items.length = 0;
      this._items.push(masterItem, ...others);
      return;
    }

    this._items.sort((a, b) => compareItemsByPref(a, b, this._masterItemPref));
    this._masterItem = this._items[0];
  }
}
