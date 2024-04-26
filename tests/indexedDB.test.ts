import { describe, expect, test, jest, beforeAll, it, afterAll, afterEach } from "@jest/globals";
import { IndexedDB, INonDuplicatePair } from "../src/modules/db";
import Dexie from "dexie";

describe("DexieDB", () => {
  let db: IndexedDB;
  const dbName = "TestDB";

  beforeAll(async () => {
    db = IndexedDB.getInstance(dbName);
    await db.init();
  });

  afterEach(async () => {
    db.nonDuplicates.clear();
  });

  afterAll(async () => {
    // await Dexie.delete(dbName);
    await db.close();
  });

  it("should insert non-duplicate pair", async () => {
    await db.insertNonDuplicatePair(1, 2, 1);
    const exists = await db.existsNonDuplicatePair(1, 2);
    expect(exists).toBe(true);
  });

  it("should insert only one pair", async () => {
    const itemID = 1;
    const itemID2 = 2;
    let anyLibraryID = 1;
    await db.insertNonDuplicatePair(itemID, itemID2, anyLibraryID);
    anyLibraryID += 1;
    await db.insertNonDuplicatePair(itemID, itemID2, anyLibraryID);
    await db.insertNonDuplicatePair(itemID2, itemID, anyLibraryID);
    const count = await db.nonDuplicates
      .where("[itemID+itemID2]")
      .equals([itemID, itemID2])
      .or("[itemID+itemID2]")
      .equals([itemID2, itemID])
      .count();
    expect(count).toBe(1);
  });

  it("should ignore the order of itemIDs", async () => {
    const itemID = 1;
    const itemID2 = 2;
    await db.insertNonDuplicatePair(itemID, itemID2, 1);
    const exists = await db.existsNonDuplicatePair(itemID2, itemID);
    expect(exists).toBe(true);
  });

  it("should sort itemIDs before inserting", async () => {
    const itemID = 1;
    const itemID2 = 2;
    await db.insertNonDuplicatePair(itemID2, itemID, 1);
    const exists = await db.nonDuplicates.where({ itemID, itemID2 }).count();
    expect(exists).toBe(1);
  });

  it("should delete non-duplicate pair", async () => {
    await db.insertNonDuplicatePair(1, 2, 1);
    await db.deleteNonDuplicatePair(1, 2);
    const exists = await db.existsNonDuplicatePair(1, 2);
    expect(exists).toBeFalsy();
  });

  it("should get non-duplicate pairs", async () => {
    const itemID = 1;
    const itemID2 = 2;
    const itemID3 = 3;
    await db.insertNonDuplicatePair(itemID, itemID2, 1);
    await db.insertNonDuplicatePair(itemID3, itemID2, 2);
    const pairs = await db.getNonDuplicates(itemID2);
    const actual = new Set(
      pairs.map((p) => {
        return { itemID: p.itemID, itemID2: p.itemID2 };
      }),
    );
    const expected = new Set([
      { itemID, itemID2 },
      { itemID: itemID2, itemID2: itemID3 }, // sorted
    ]);
    expect(actual).toEqual(expected);
  });
});
