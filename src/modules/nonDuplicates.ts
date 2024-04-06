import { DB } from "./db";
import { patchNonDuplicates } from "./patcher";

export class NonDuplicates {
  private static _instance: NonDuplicates;

  public allNonDuplicates: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): NonDuplicates {
    if (!NonDuplicates._instance) {
      NonDuplicates._instance = new NonDuplicates();
    }
    return NonDuplicates._instance;
  }

  init(db: DB) {
    patchNonDuplicates(db);
  }
}
