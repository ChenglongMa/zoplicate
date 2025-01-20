import { SQLiteDB } from "./db";

export class NonDuplicatesDB extends SQLiteDB {
  private static _instance: NonDuplicatesDB;
  private readonly batchSize = 100; // Define a batch size to avoid too many parameters

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

    for (let i = 0; i < rows.length; i += this.batchSize) {
      const batch = rows.slice(i, i + this.batchSize);
      const placeholders = batch.map(() => "(?, ?, ?)").join(",");
      const values = batch.flatMap(({ itemID, itemID2 }) => this.buildRow(itemID, itemID2, libraryID));
      await this._db.queryAsync(
        `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2, libraryID)
         VALUES ${placeholders};`,
        values,
      );
    }
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
    for (let i = 0; i < rows.length; i += this.batchSize) {
      const batch = rows.slice(i, i + this.batchSize);
      const placeholders = batch.map(() => "(?, ?), (?, ?)").join(",");
      const values = batch.flatMap(({ itemID, itemID2 }) => [itemID, itemID2, itemID2, itemID]);
      await this._db.queryAsync(
        `DELETE
         FROM ${this.tables.nonDuplicates}
         WHERE (itemID, itemID2) IN (${placeholders});`,
        values,
      );
    }
  }

  async deleteNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => ({ itemID, itemID2 })));
    await this.deleteNonDuplicatePairs(...rows);
  }

  async deleteRecords(...itemIDs: number[]) {
    for (let i = 0; i < itemIDs.length; i += this.batchSize) {
      const batch = itemIDs.slice(i, i + this.batchSize);
      const placeholders = batch.map(() => "?").join(", ");
      const ids = batch.flatMap((itemID) => [itemID, itemID]);

      await this._db.queryAsync(
        `DELETE
         FROM ${this.tables.nonDuplicates}
         WHERE itemID IN (${placeholders})
            OR itemID2 IN (${placeholders});`,
        ids,
      );
    }
  }

  async existsNonDuplicatePair(itemID: number, itemID2: number) {
    const result = (await this._db.queryAsync(
      `SELECT EXISTS(SELECT 1
                     FROM ${this.tables.nonDuplicates}
                     WHERE (itemID = ? AND itemID2 = ?)
                        OR (itemID = ? AND itemID2 = ?)) AS existsResult;`,
      [itemID, itemID2, itemID2, itemID],
    )) as { existsResult: number }[];

    return result?.[0]?.existsResult ?? false;
  }

  async existsNonDuplicates(itemIDs: number[]) {
    const rows = itemIDs.flatMap((itemID, i) => itemIDs.slice(i + 1).map((itemID2) => [itemID, itemID2].sort()));
    for (let i = 0; i < rows.length; i += this.batchSize) {
      const batch = rows.slice(i, i + this.batchSize);
      const placeholders = batch.map(() => "(?, ?)").join(", ");
      const query = `SELECT COUNT(*) AS count
                     FROM ${this.tables.nonDuplicates}
                     WHERE (itemID, itemID2) IN (${placeholders});`;
      const result = (await this._db.queryAsync(query, batch.flat())) as { count: number }[];
      if (result[0].count !== batch.length) {
        return false;
      }
    }
    return true;
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

    return (await this._db.queryAsync(query, params)) as { itemID: number; itemID2: number }[];
  }
}
