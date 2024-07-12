import { SQLiteDB } from "./db";

export class NonDuplicatesDB extends SQLiteDB {
  private static _instance: NonDuplicatesDB;

  private constructor() {
    super();
  }

  public static get instance(): NonDuplicatesDB {
    if (!NonDuplicatesDB._instance) {
      NonDuplicatesDB._instance = new NonDuplicatesDB();
    }
    return NonDuplicatesDB._instance;
  }

  async init() {
    await this.createNonDuplicateTable();
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
    rows = rows.filter((row) => row.itemID !== row.itemID2);
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

  /**
   * Delete all pairs of non-duplicates for the given itemIDs.
   * @param itemIDs
   */
  async deleteNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => ({ itemID, itemID2 })));
    await this.deleteNonDuplicatePairs(...rows);
  }

  /**
   * Delete all records containing the given itemIDs.
   * @param itemIDs
   */
  async deleteRecords(...itemIDs: number[]) {
    const placeholders = itemIDs.map(() => "?").join(", ");
    const ids = itemIDs.flatMap((itemID) => [itemID, itemID]);

    await this._db.queryAsync(
      `DELETE
       FROM ${this.tables.nonDuplicates}
       WHERE itemID IN (${placeholders})
          OR itemID2 IN (${placeholders});`,
      ids,
    );
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
}
