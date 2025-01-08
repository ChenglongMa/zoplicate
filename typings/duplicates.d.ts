// https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/duplicates.js
declare namespace Zotero {
  class Duplicates {
    constructor(libraryID?: number);

    readonly name: string;
    readonly libraryID: number;

    getSearchObject(): Promise<Zotero.Search>;
    getSetItemsByItemID(itemID: number): number[];
    _getObjectFromID(id: number): { id: number };
    _findDuplicates(): Promise<void>;
  }

  class DisjointSetForest {
    constructor();

    find(x: { id: number }): { id: number, parent: { id: number }, rank: number };
    union(x: { id: number }, y: { id: number }): void;
    sameSet(x: { id: number }, y: { id: number }): boolean;
    findAll(asIDs: boolean): Array<{ id: number } | number>;
    findAllInSet(x: { id: number }, asIDs: boolean): Array<{ id: number } | number>;
    _makeSet(x: { id: number }): void;
  }
}
