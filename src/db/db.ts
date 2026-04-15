import { config } from "../../package.json";

export abstract class SQLiteDB {
  protected readonly _db: typeof Zotero.DBConnection;
  protected readonly tables: { [key: string]: string } = {
    nonDuplicates: "nonDuplicates",
    // merged: "merged",
  };

  protected constructor() {
    this._db = new Zotero.DBConnection(config.addonRef);
  }

  public get db() {
    return this._db;
  }

  async close(permanent: boolean = false) {
    await this._db.closeDatabase(permanent);
  }

  /**
   * Read the current schema version from the schemaVersion table.
   * Returns 0 if the table doesn't exist or is empty (pre-versioning install).
   */
  protected async getSchemaVersion(): Promise<number> {
    try {
      const rows = (await this._db.queryAsync(
        `SELECT version FROM schemaVersion LIMIT 1`,
      )) as { version: number }[];
      return rows.length > 0 ? rows[0].version : 0;
    } catch {
      // Table doesn't exist yet
      return 0;
    }
  }

  /**
   * Ensure the schemaVersion table exists and set the version.
   */
  protected async setSchemaVersion(version: number): Promise<void> {
    await this._db.queryAsync(
      `CREATE TABLE IF NOT EXISTS schemaVersion (version INTEGER NOT NULL)`,
    );
    const rows = (await this._db.queryAsync(
      `SELECT version FROM schemaVersion LIMIT 1`,
    )) as { version: number }[];
    if (rows.length === 0) {
      await this._db.queryAsync(`INSERT INTO schemaVersion (version) VALUES (?)`, [version]);
    } else {
      await this._db.queryAsync(`UPDATE schemaVersion SET version = ?`, [version]);
    }
  }

  /**
   * Run a function inside a database transaction.
   * Falls back to direct execution if executeTransaction is not available.
   */
  protected async executeTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof this._db.executeTransaction === "function") {
      return this._db.executeTransaction(fn);
    }
    return fn();
  }
}
