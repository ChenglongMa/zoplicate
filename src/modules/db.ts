import { config } from "../../package.json";

export class DB {
  private static _instance: DB;
  // @ts-ignore
  private _db: Zotero.DBConnection;
  private tables = {
    nonDuplicates: "nonDuplicates",
  };

  private constructor() {}

  public static getInstance(): DB {
    if (!DB._instance) {
      DB._instance = new DB();
    }
    return DB._instance;
  }

  async init() {
    this._db = new Zotero.DBConnection(config.addonRef);
    await this.createNonDuplicateTable();
    ztoolkit.log("DB initialized");
  }

  async createNonDuplicateTable() {
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
       VALUES (?, ?),
              (?, ?);`,
      [itemID, itemID2, itemID2, itemID],
    );
  }

  async insertNonDuplicatePairs(...rows: { itemID: number; itemID2: number }[]) {
    const placeholders = rows.map(() => "(?, ?), (?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => [itemID, itemID2, itemID2, itemID]);
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

  async close(permanent: boolean = false) {
    await this._db.closeDatabase(permanent);
    Zotero.debug("Closing DB");
  }
}
