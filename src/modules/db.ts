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

  async insertNonDuplicate(itemID: number, itemID2: number) {
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2)
       VALUES (?, ?),
              (?, ?);`,
      [itemID, itemID2, itemID2, itemID],
    );
  }

  async insertNonDuplicates(...rows: { itemID: number; itemID2: number }[]) {
    const placeholders = rows.map(() => "(?, ?), (?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => [itemID, itemID2, itemID2, itemID]);
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2)
       VALUES ${placeholders};`,
      values,
    );
  }

  async deleteNonDuplicate(itemID: number, itemID2: number) {
    await this._db.queryAsync(
      `DELETE
       FROM ${this.tables.nonDuplicates}
       WHERE (itemID = ? AND itemID2 = ?)
          OR (itemID = ? AND itemID2 = ?);`,
      [itemID, itemID2, itemID2, itemID],
    );
  }

  async deleteNonDuplicates(...rows: { itemID: number; itemID2: number }[]) {
    const placeholders = rows.map(() => "(?, ?), (?, ?)").join(",");
    const values = rows.flatMap(({ itemID, itemID2 }) => [itemID, itemID2, itemID2, itemID]);
    await this._db.queryAsync(
      `DELETE
       FROM ${this.tables.nonDuplicates}
       WHERE (itemID, itemID2) IN (${placeholders});`,
      values,
    );
  }

  async close(permanent: boolean = false) {
    await this._db.closeDatabase(permanent);
    Zotero.debug("Closing DB");
  }
}
