import { config } from "../../package.json";
import Dexie, { Table } from "dexie";

export interface IDatabase {
  init(): Promise<void>;

  get db(): Dexie | typeof Zotero.DBConnection;

  insertNonDuplicatePair(itemID: number, itemID2: number): Promise<void>;

  insertNonDuplicatePairs(rows: { itemID: number; itemID2: number }[]): Promise<void>;

  insertNonDuplicates(itemIDs: number[]): Promise<void>;

  deleteNonDuplicatePair(itemID: number, itemID2: number): Promise<void>;

  deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void>;

  deleteNonDuplicates(itemIDs: number[]): Promise<void>;

  existsNonDuplicatePair(itemID: number, itemID2: number): Promise<boolean>;

  existsNonDuplicates(itemIDs: number[]): Promise<boolean>;

  getNonDuplicates(itemID?: number): Promise<{ itemID: number; itemID2: number }[]>;

  close(): Promise<void>;
}

export interface INonDuplicatePair {
  id?: number;
  itemID: number;
  itemID2: number;
  libraryID: number;
}

export class IndexedDB extends Dexie implements IDatabase {
  nonDuplicates!: Table<INonDuplicatePair>;

  private static _instance: IndexedDB;

  private constructor(databaseName: string = config.addonName) {
    super(databaseName);
    this.version(1).stores({
      nonDuplicates: "++id, &[itemID+itemID2], itemID, itemID2, libraryID",
    });
  }

  public static getInstance(databaseName: string = config.addonName): IndexedDB {
    if (!IndexedDB._instance) {
      IndexedDB._instance = new IndexedDB(databaseName);
    }
    return IndexedDB._instance;
  }

  get db(): Dexie | typeof Zotero.DBConnection {
    return this;
  }

  async init() {
    // await this._db.open();
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number, libraryID?: number) {
    if (await this.existsNonDuplicatePair(itemID, itemID2)) {
      // ztoolkit.log("Pair already exists: ", itemID, itemID2);
      return;
    }
    libraryID = libraryID ?? Zotero.Items.get(itemID).libraryID;
    // Sort itemID and itemID2 to avoid duplicates
    if (itemID > itemID2) {
      [itemID, itemID2] = [itemID2, itemID];
    }
    await this.nonDuplicates.put({ itemID, itemID2, libraryID });
  }

  async insertNonDuplicatePairs(rows: { itemID: number; itemID2: number }[], libraryID?: number): Promise<void> {
    libraryID = libraryID ?? Zotero.Items.get(rows[0].itemID).libraryID;
    await this.nonDuplicates.bulkPut(rows.map(({ itemID, itemID2 }) => ({ itemID, itemID2, libraryID })));
  }

  private getUniquePairs(
    itemIDs: number[],
    libraryID?: number,
  ): {
    itemID: number;
    itemID2: number;
    libraryID: number;
  }[] {
    libraryID = libraryID ?? Zotero.Items.get(itemIDs[0]).libraryID;
    const rows: { itemID: number; itemID2: number; libraryID: number }[] = [];
    const seenPairs: Set<string> = new Set();

    for (let i = 0; i < itemIDs.length; i++) {
      for (let j = i + 1; j < itemIDs.length; j++) {
        const pairKey = `${itemIDs[i]}-${itemIDs[j]}`;
        if (!seenPairs.has(pairKey)) {
          rows.push({ itemID: itemIDs[i], itemID2: itemIDs[j], libraryID });
          seenPairs.add(pairKey);
        }
      }
    }
    return rows;
  }

  async insertNonDuplicates(itemIDs: number[], libraryID?: number): Promise<void> {
    await this.nonDuplicates.bulkPut(this.getUniquePairs(itemIDs, libraryID));
  }

  async deleteNonDuplicatePair(itemID: number, itemID2: number) {
    await this.nonDuplicates
      .where("[itemID+itemID2]")
      .between([itemID, itemID2], [itemID2, itemID], true, true)
      .delete();
  }

  async deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]) {
    const sortedRows = rows.map(({ itemID, itemID2 }) => {
      if (itemID < itemID2) {
        return { itemID, itemID2 };
      } else {
        return { itemID: itemID2, itemID2: itemID };
      }
    });
    await this.nonDuplicates.bulkDelete(sortedRows);
  }

  async deleteNonDuplicates(itemIDs: number[]) {
    await this.nonDuplicates.bulkDelete(this.getUniquePairs(itemIDs));
  }

  async existsNonDuplicatePair(itemID: number, itemID2: number) {
    const result = await this.nonDuplicates
      .where("[itemID+itemID2]")
      .anyOf([
        [itemID, itemID2],
        [itemID2, itemID],
      ])
      .first();
    return result !== undefined;
  }

  async existsNonDuplicates(itemIDs: number[]): Promise<boolean> {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => [itemID, itemID2].sort()));
    const result = await this.nonDuplicates.where("[itemID+itemID2]").anyOf(rows).toArray();
    return result.length === rows.length;
  }

  async getNonDuplicates(itemID?: number): Promise<{ itemID: number; itemID2: number }[]> {
    if (itemID !== undefined && itemID !== null) {
      return this.nonDuplicates.where("itemID").equals(itemID).or("itemID2").equals(itemID).toArray();
    } else {
      return this.nonDuplicates.toArray();
    }
  }

  async close() {
    super.close();
  }
}

export class SQLiteDB implements IDatabase {
  private static _instance: SQLiteDB;
  private readonly _db: typeof Zotero.DBConnection;
  private tables = {
    nonDuplicates: "nonDuplicates",
  };

  private constructor() {
    this._db = new Zotero.DBConnection(config.addonRef);
  }

  public static getInstance(): SQLiteDB {
    if (!SQLiteDB._instance) {
      SQLiteDB._instance = new SQLiteDB();
    }
    return SQLiteDB._instance;
  }

  public get db() {
    return this._db;
  }

  async init() {
    await this.createNonDuplicateTable();
    ztoolkit.log("DB initialized");
  }

  private async createNonDuplicateTable() {
    await this._db.queryAsync(
      `CREATE TABLE IF NOT EXISTS ${this.tables.nonDuplicates}
       (
           itemID  INTEGER,
           itemID2 INTEGER,
           PRIMARY KEY (itemID, itemID2)
       );`,
    );
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number) {
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2)
       VALUES (?, ?);`,
      [itemID, itemID2].sort(),
    );
  }

  async insertNonDuplicatePairs(rows: { itemID: number; itemID2: number }[]) {
    const placeholders = rows.map(() => "(?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => [itemID, itemID2].sort());
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2)
       VALUES ${placeholders};`,
      values,
    );
  }

  async insertNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => ({ itemID, itemID2 })));
    await this.insertNonDuplicatePairs(rows);
  }

  async deleteNonDuplicatePair(itemID: number, itemID2: number) {
    await this._db.queryAsync(
      `DELETE
       FROM ${this.tables.nonDuplicates}
       WHERE (itemID = ? AND itemID2 = ?)
          OR (itemID = ? AND itemID2 = ?);`,
      [itemID, itemID2, itemID2, itemID],
    );
  }

  async deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]) {
    const placeholders = rows.map(() => "(?, ?), (?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => [itemID, itemID2, itemID2, itemID]);
    await this._db.queryAsync(
      `DELETE
       FROM ${this.tables.nonDuplicates}
       WHERE (itemID, itemID2) IN (${placeholders});`,
      values,
    );
  }

  async deleteNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => ({ itemID, itemID2 })));
    await this.deleteNonDuplicatePairs(...rows);
  }

  async existsNonDuplicatePair(itemID: number, itemID2: number) {
    const result = await this._db.queryAsync(
      `SELECT EXISTS(SELECT 1
                     FROM ${this.tables.nonDuplicates}
                     WHERE (itemID = ? AND itemID2 = ?)
                        OR (itemID = ? AND itemID2 = ?)) AS existsResult;`,

      [itemID, itemID2, itemID2, itemID],
    );
    return !!result[0].existsResult;
  }

  async existsNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => [itemID, itemID2].sort()));
    const placeholders = rows.map(() => "(?, ?)").join(", ");
    const query = `SELECT COUNT(*) AS count
                   FROM ${this.tables.nonDuplicates}
                   WHERE (itemID, itemID2) IN (${placeholders});`;
    const result = await this._db.queryAsync(query, rows.flat());
    ztoolkit.log("existsNonDuplicates called");
    return result[0].count === rows.length;
  }

  async getNonDuplicates(itemID: number | undefined = undefined) {
    const params: number[] = [];
    let query = `SELECT itemID, itemID2
                 FROM ${this.tables.nonDuplicates}`;

    if (itemID !== undefined && itemID !== null) {
      query += ` WHERE itemID = ? OR itemID2 = ?`;
      params.push(itemID, itemID);
    }

    const rows: { itemID: number; itemID2: number }[] = await this._db.queryAsync(query, params);
    return rows;
  }

  async close(permanent: boolean = false) {
    await this._db.closeDatabase(permanent);
  }
}
