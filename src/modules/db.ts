import { config } from "../../package.json";
import Dexie, { DexieOptions, Table } from "dexie";

export interface IDatabase {
  init(): Promise<void>;

  get db(): Dexie | typeof Zotero.DBConnection;

  insertNonDuplicatePair(itemID: number, itemID2: number, libraryID?: number): Promise<void>;

  insertNonDuplicatePairs(rows: { itemID: number; itemID2: number }[], libraryID?: number): Promise<void>;

  insertNonDuplicates(itemIDs: number[], libraryID?: number): Promise<void>;

  deleteNonDuplicatePair(itemID: number, itemID2: number): Promise<void>;

  deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void>;

  deleteNonDuplicates(itemIDs: number[]): Promise<void>;

  existsNonDuplicatePair(itemID: number, itemID2: number): Promise<boolean>;

  existsNonDuplicates(itemIDs: number[]): Promise<boolean>;

  getNonDuplicates({ itemID, libraryID }: { itemID?: number; libraryID?: number }): Promise<
    {
      itemID: number;
      itemID2: number;
    }[]
  >;

  close(): Promise<void>;
}

export interface INonDuplicatePair {
  id?: number;
  itemID: number;
  itemID2: number;
  libraryID: number;
}

class DexieDB extends Dexie implements IDatabase {
  nonDuplicates!: Table<INonDuplicatePair>;

  private static _instance: DexieDB;

  private constructor(databaseName: string = config.addonName, options?: DexieOptions) {
    super(databaseName, options);
    this.version(1).stores({
      nonDuplicates: "++id, &[itemID+itemID2], itemID, itemID2, libraryID",
    });
  }

  public static getInstance(databaseName: string = config.addonName, options?: DexieOptions): DexieDB {
    if (!DexieDB._instance) {
      DexieDB._instance = new DexieDB(databaseName, options);
    }
    return DexieDB._instance;
  }

  get db(): Dexie | typeof Zotero.DBConnection {
    return this;
  }

  async init() {
    // await this.open();
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number, libraryID?: number) {
    if (await this.existsNonDuplicatePair(itemID, itemID2)) {
      ztoolkit.log("Pair already exists: ", itemID, itemID2);
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

  private getUniquePairs(itemIDs: number[], libraryID?: number): INonDuplicatePair[] {
    libraryID = libraryID ?? Zotero.Items.get(itemIDs[0]).libraryID;
    const rows: { itemID: number; itemID2: number; libraryID: number }[] = [];
    const seenPairs: Set<string> = new Set();

    for (let i = 0; i < itemIDs.length; i++) {
      for (let j = i + 1; j < itemIDs.length; j++) {
        const pairKey = `${itemIDs[i]}-${itemIDs[j]}`;
        if (!seenPairs.has(pairKey)) {
          const itemID = Math.min(itemIDs[i], itemIDs[j]);
          const itemID2 = Math.max(itemIDs[i], itemIDs[j]);
          rows.push({ itemID, itemID2, libraryID });
          seenPairs.add(pairKey);
        }
      }
    }
    ztoolkit.log("Unique pairs:", rows);
    return rows;
  }

  async insertNonDuplicates(itemIDs: number[], libraryID?: number): Promise<void> {
    const records = this.getUniquePairs(itemIDs, libraryID);
    await this.nonDuplicates.bulkPut(records);
    ztoolkit.log("Inserted non-duplicates done");
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

  async getNonDuplicates({ itemID, libraryID }: { itemID?: number; libraryID?: number }): Promise<
    {
      itemID: number;
      itemID2: number;
    }[]
  > {
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

class SQLiteDB implements IDatabase {
  private static _instance: SQLiteDB;
  private readonly _db: typeof Zotero.DBConnection;
  private readonly tables = {
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
           itemID    INTEGER,
           itemID2   INTEGER,
           libraryID INTEGER,
           PRIMARY KEY (itemID, itemID2)
       );`,
    );
  }

  private buildRow(itemID: number, itemID2: number, libraryID: number) {
    return itemID > itemID2 ? [itemID2, itemID, libraryID] : [itemID, itemID2, libraryID];
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number, libraryID?: number) {
    if (itemID === itemID2) {
      return;
    }
    libraryID = libraryID ?? Zotero.Items.get(itemID).libraryID;
    const row = this.buildRow(itemID, itemID2, libraryID);
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2, libraryID)
       VALUES (?, ?, ?);`,
      row,
    );
  }

  async insertNonDuplicatePairs(rows: { itemID: number; itemID2: number }[], libraryID?: number) {
    rows = rows.filter(row => row.itemID !== row.itemID2);
    if (rows.length === 0) {
      return;
    }
    libraryID = libraryID ?? Zotero.Items.get(rows[0].itemID).libraryID;
    const placeholders = rows.map(() => "(?, ?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => this.buildRow(itemID, itemID2, libraryID));
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2, libraryID)
       VALUES ${placeholders};`,
      values,
    );
  }

  async insertNonDuplicates(itemIDs: number[], libraryID?: number) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => ({ itemID, itemID2 })));
    await this.insertNonDuplicatePairs(rows, libraryID);
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
    return result[0].count === rows.length;
  }

  async getNonDuplicates({ itemID, libraryID }: { itemID?: number; libraryID?: number }) {
    const params: number[] = [];
    let query = `SELECT itemID, itemID2
                 FROM ${this.tables.nonDuplicates}`;

    if (itemID !== undefined && itemID !== null) {
      query += ` WHERE itemID = ? OR itemID2 = ?`;
      params.push(itemID, itemID);
    }

    if (libraryID !== undefined && libraryID !== null) {
      query += ` WHERE libraryID = ?`;
      params.push(libraryID);
    }

    const rows: { itemID: number; itemID2: number }[] = await this._db.queryAsync(query, params);
    return rows;
  }

  async close(permanent: boolean = false) {
    await this._db.closeDatabase(permanent);
  }
}

export default {
  getDatabase: (dbType: "IndexedDB" | "SQLite" = addon.data.database): IDatabase => {
    if (dbType === "IndexedDB") {
      return DexieDB.getInstance();
    } else {
      return SQLiteDB.getInstance();
    }
  },
};
