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
}
