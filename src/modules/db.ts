import { config } from "../../package.json";
import Dexie, { Table } from "dexie";

interface IDatabase {
  init(): Promise<void>;

  get db(): Dexie | typeof Zotero.DBConnection;

  insertNonDuplicatePair(itemID: number, itemID2: number): Promise<void>;

  insertNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void>;

  deleteNonDuplicatePair(itemID: number, itemID2: number): Promise<void>;

  deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void>;

  deleteNonDuplicates(itemIDs: number[]): Promise<void>;

  existsNonDuplicatePair(itemID: number, itemID2: number): Promise<boolean>;

  existsNonDuplicates(itemIDs: number[]): Promise<boolean>;

  getNonDuplicates(itemID?: number): Promise<{ itemID: number; itemID2: number }[]>;

  close(): Promise<void>;
}

export interface NonDuplicatePair {
  id?: number;
  itemID: number;
  itemID2: number;
}

export class DexieDB implements IDatabase {
  private static _instance: DexieDB;
  private readonly _db: Dexie;
  nonDuplicates!: Table<NonDuplicatePair>;

  private constructor() {
    this._db = new Dexie(config.addonName);
    this._db.version(1).stores({
      nonDuplicates: "++id, itemID, itemID2",
    });
  }

  public static getInstance(): DexieDB {
    if (!DexieDB._instance) {
      DexieDB._instance = new DexieDB();
    }
    return DexieDB._instance;
  }

  public get db() {
    return this._db;
  }

  async init() {
    await this._db.open();
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number) {
    await this.nonDuplicates.put({ itemID, itemID2 });
  }

  insertNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void> {
    return Promise.resolve(undefined);
  }

  async deleteNonDuplicatePair(itemID: number, itemID2: number) {
    await this.nonDuplicates.where({ itemID, itemID2 }).delete();
  }

  deleteNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]): Promise<void> {
    return Promise.resolve(undefined);
  }

  deleteNonDuplicates(itemIDs: number[]): Promise<void> {
    return Promise.resolve(undefined);
  }

  async existsNonDuplicatePair(itemID: number, itemID2: number) {
    const result = await this.nonDuplicates.where({ itemID, itemID2 }).count();
    return result > 0;
  }

  existsNonDuplicates(itemIDs: number[]): Promise<boolean> {
    return Promise.resolve(false);
  }

  async getNonDuplicates(itemID?: number) {
    if (itemID !== undefined && itemID !== null) {
      return this.nonDuplicates.where("itemID").equals(itemID).toArray();
    } else {
      return this.nonDuplicates.toArray();
    }
  }

  async close() {
    this._db.close();
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

  async insertNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]) {
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
    await this.insertNonDuplicatePairs(...rows);
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
