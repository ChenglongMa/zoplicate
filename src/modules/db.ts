import { config } from "../../package.json";

export class DB {
  private static _instance: DB;
  private readonly _db: typeof Zotero.DBConnection;
  private tables = {
    nonDuplicates: "nonDuplicates",
  };

  private constructor() {
    this._db = new Zotero.DBConnection(config.addonRef);
  }

  public static getInstance(): DB {
    if (!DB._instance) {
      DB._instance = new DB();
    }
    return DB._instance;
  }

  public get db() {
    return this._db;
  }

  async init() {
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
    Zotero.debug("Closing DB");
  }
}
