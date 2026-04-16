import { SQLiteDB } from "./db";

export interface NonDuplicateRow {
  itemID: number;
  itemID2: number;
  libraryID: number;
  itemKey: string | null;
  itemKey2: string | null;
}

export interface NonDuplicateKeyPair {
  key1: string;
  key2: string;
}

export class NonDuplicatesDB extends SQLiteDB {
  private static _instance: NonDuplicatesDB;
  private readonly batchSize = 100; // Define a batch size to avoid too many parameters

  /** Current target schema version. Increment when adding new migrations. */
  static readonly SCHEMA_VERSION = 1;

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
    await this.migrateSchema();
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

  /**
   * Run schema migrations sequentially from current version to SCHEMA_VERSION.
   */
  private async migrateSchema() {
    const currentVersion = await this.getSchemaVersion();

    if (currentVersion >= NonDuplicatesDB.SCHEMA_VERSION) {
      return;
    }

    await this.executeTransaction(async () => {
      if (currentVersion < 1) {
        await this.migrateToV1();
      }
      // Future migrations: if (currentVersion < 2) { await this.migrateToV2(); }

      await this.setSchemaVersion(NonDuplicatesDB.SCHEMA_VERSION);
    });

    // Backfill keys outside the migration transaction (may touch Zotero APIs)
    if (currentVersion < 1) {
      await this.backfillKeys();
    }
  }

  /**
   * Migration v0 → v1: Add itemKey/itemKey2 columns and libraryID index.
   */
  private async migrateToV1() {
    // Check if columns already exist (idempotent for interrupted migrations)
    const tableInfo = (await this._db.queryAsync(
      `PRAGMA table_info(${this.tables.nonDuplicates})`,
    )) as { name: string }[];
    const columnNames = new Set(tableInfo.map((col) => col.name));

    if (!columnNames.has("itemKey")) {
      await this._db.queryAsync(
        `ALTER TABLE ${this.tables.nonDuplicates} ADD COLUMN itemKey TEXT`,
      );
    }
    if (!columnNames.has("itemKey2")) {
      await this._db.queryAsync(
        `ALTER TABLE ${this.tables.nonDuplicates} ADD COLUMN itemKey2 TEXT`,
      );
    }

    await this._db.queryAsync(
      `CREATE INDEX IF NOT EXISTS idx_nonDuplicates_libraryID ON ${this.tables.nonDuplicates} (libraryID)`,
    );
  }

  /**
   * Backfill itemKey/itemKey2 for rows that have NULL keys.
   * Resolves keys via Zotero.Items.get(). Deletes rows where items no longer exist.
   */
  async backfillKeys() {
    const rows = (await this._db.queryAsync(
      `SELECT itemID, itemID2, libraryID FROM ${this.tables.nonDuplicates}
       WHERE itemKey IS NULL OR itemKey2 IS NULL`,
    )) as { itemID: number; itemID2: number; libraryID: number }[];

    if (rows.length === 0) {
      return;
    }

    const toUpdate: { itemID: number; itemID2: number; key1: string; key2: string }[] = [];
    const toDelete: { itemID: number; itemID2: number }[] = [];

    for (const row of rows) {
      const item1 = Zotero.Items.get(row.itemID);
      const item2 = Zotero.Items.get(row.itemID2);
      if (!item1?.key || !item2?.key) {
        toDelete.push({ itemID: row.itemID, itemID2: row.itemID2 });
      } else {
        toUpdate.push({ itemID: row.itemID, itemID2: row.itemID2, key1: item1.key, key2: item2.key });
      }
    }

    await this.executeTransaction(async () => {
      // Delete orphan rows
      for (let i = 0; i < toDelete.length; i += this.batchSize) {
        const batch = toDelete.slice(i, i + this.batchSize);
        const placeholders = batch.map(() => "(?, ?)").join(",");
        const values = batch.flatMap(({ itemID, itemID2 }) => [itemID, itemID2]);
        await this._db.queryAsync(
          `DELETE FROM ${this.tables.nonDuplicates}
           WHERE (itemID, itemID2) IN (${placeholders})`,
          values,
        );
      }

      // Update rows with resolved keys
      for (const row of toUpdate) {
        await this._db.queryAsync(
          `UPDATE ${this.tables.nonDuplicates}
           SET itemKey = ?, itemKey2 = ?
           WHERE itemID = ? AND itemID2 = ?`,
          [row.key1, row.key2, row.itemID, row.itemID2],
        );
      }
    });
  }

  private buildRow(itemID: number, itemID2: number, libraryID: number, key1?: string, key2?: string) {
    if (itemID > itemID2) {
      return [itemID2, itemID, libraryID, key2 ?? null, key1 ?? null];
    }
    return [itemID, itemID2, libraryID, key1 ?? null, key2 ?? null];
  }

  private resolveKey(itemID: number): string | null {
    try {
      const item = Zotero.Items.get(itemID);
      return item?.key ?? null;
    } catch {
      return null;
    }
  }

  async insertNonDuplicatePair(itemID: number, itemID2: number, libraryID?: number) {
    if (itemID === itemID2) {
      return;
    }
    libraryID = libraryID ?? Zotero.Items.get(itemID).libraryID;
    const key1 = this.resolveKey(itemID);
    const key2 = this.resolveKey(itemID2);
    const row = this.buildRow(itemID, itemID2, libraryID, key1 ?? undefined, key2 ?? undefined);
    await this._db.queryAsync(
      `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2, libraryID, itemKey, itemKey2)
       VALUES (?, ?, ?, ?, ?);`,
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
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
      const values = batch.flatMap(({ itemID, itemID2 }) => {
        const key1 = this.resolveKey(itemID);
        const key2 = this.resolveKey(itemID2);
        return this.buildRow(itemID, itemID2, libraryID, key1 ?? undefined, key2 ?? undefined);
      });
      await this._db.queryAsync(
        `INSERT OR IGNORE INTO ${this.tables.nonDuplicates} (itemID, itemID2, libraryID, itemKey, itemKey2)
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
    const conditions: string[] = [];
    let query = `SELECT itemID, itemID2
                 FROM ${this.tables.nonDuplicates}`;

    if (itemID !== undefined && itemID !== null) {
      conditions.push(`(itemID = ? OR itemID2 = ?)`);
      params.push(itemID, itemID);
    }

    if (libraryID !== undefined && libraryID !== null) {
      conditions.push(`libraryID = ?`);
      params.push(libraryID);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    return (await this._db.queryAsync(query, params)) as { itemID: number; itemID2: number }[];
  }

  /**
   * Get all unique keys (from both itemKey and itemKey2 columns) and their
   * libraryIDs for a set of itemIDs.
   */
  async getKeysForItems(itemIDs: number[]): Promise<{ key: string; libraryID: number }[]> {
    if (itemIDs.length === 0) return [];

    const results: { key: string; libraryID: number }[] = [];

    for (let i = 0; i < itemIDs.length; i += this.batchSize) {
      const batch = itemIDs.slice(i, i + this.batchSize);
      const placeholders = batch.map(() => "?").join(", ");

      // Query rows where itemID or itemID2 is in the batch
      const rows = (await this._db.queryAsync(
        `SELECT DISTINCT itemKey, itemKey2, libraryID
         FROM ${this.tables.nonDuplicates}
         WHERE (itemID IN (${placeholders}) OR itemID2 IN (${placeholders}))
           AND (itemKey IS NOT NULL OR itemKey2 IS NOT NULL)`,
        [...batch, ...batch],
      )) as { itemKey: string | null; itemKey2: string | null; libraryID: number }[];

      // Collect all non-null keys
      for (const row of rows) {
        if (row.itemKey) results.push({ key: row.itemKey, libraryID: row.libraryID });
        if (row.itemKey2) results.push({ key: row.itemKey2, libraryID: row.libraryID });
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return results.filter((r) => {
      const k = `${r.libraryID}\0${r.key}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * Get non-duplicate pairs as stable item key pairs for a library.
   * Only returns rows where both keys are non-null.
   */
  async getNonDuplicateKeys({ libraryID }: { libraryID: number }): Promise<NonDuplicateKeyPair[]> {
    const rows = (await this._db.queryAsync(
      `SELECT itemKey, itemKey2 FROM ${this.tables.nonDuplicates}
       WHERE libraryID = ? AND itemKey IS NOT NULL AND itemKey2 IS NOT NULL`,
      [libraryID],
    )) as { itemKey: string; itemKey2: string }[];

    return rows.map((row) => ({ key1: row.itemKey, key2: row.itemKey2 }));
  }
}
