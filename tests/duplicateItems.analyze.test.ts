import { describe, expect, test, beforeEach } from "@jest/globals";
import { DuplicateItems } from "../src/modules/duplicateItems";
import { MasterItem } from "../src/utils/prefs";
import { createMockItem } from "./__setup__/globals";

/**
 * Tests for DuplicateItems master-item selection logic.
 * analyze() is private -- we exercise it through the public masterItem
 * and otherItems getters which trigger lazy analysis.
 */

// Shared mock items used across strategy tests
let itemOldest: any;
let itemMiddle: any;
let itemNewest: any;

beforeEach(() => {
  itemOldest = createMockItem({
    id: 10,
    dateAdded: "2020-01-01 00:00:00",
    dateModified: "2024-06-01 00:00:00",
    usedFields: ["title"],
    displayTitle: "Oldest Item",
  });
  itemMiddle = createMockItem({
    id: 20,
    dateAdded: "2022-01-01 00:00:00",
    dateModified: "2023-01-01 00:00:00",
    usedFields: ["title", "author"],
    displayTitle: "Middle Item",
  });
  itemNewest = createMockItem({
    id: 30,
    dateAdded: "2024-01-01 00:00:00",
    dateModified: "2025-01-01 00:00:00",
    usedFields: ["title", "author", "date"],
    displayTitle: "Newest Item",
  });
});

describe("DuplicateItems - OLDEST strategy", () => {
  test("masterItem returns the item with the oldest dateAdded", () => {
    const dup = new DuplicateItems([itemNewest, itemOldest, itemMiddle], MasterItem.OLDEST);
    expect(dup.masterItem.id).toBe(itemOldest.id);
  });

  test("otherItems returns all items except the master", () => {
    const dup = new DuplicateItems([itemNewest, itemOldest, itemMiddle], MasterItem.OLDEST);
    const otherIds = dup.otherItems.map((i) => i.id);
    expect(otherIds).not.toContain(itemOldest.id);
    expect(otherIds).toHaveLength(2);
  });
});

describe("DuplicateItems - NEWEST strategy", () => {
  test("masterItem returns the item with the newest dateAdded", () => {
    const dup = new DuplicateItems([itemOldest, itemMiddle, itemNewest], MasterItem.NEWEST);
    expect(dup.masterItem.id).toBe(itemNewest.id);
  });

  test("otherItems returns all items except the master", () => {
    const dup = new DuplicateItems([itemOldest, itemMiddle, itemNewest], MasterItem.NEWEST);
    const otherIds = dup.otherItems.map((i) => i.id);
    expect(otherIds).not.toContain(itemNewest.id);
    expect(otherIds).toHaveLength(2);
  });
});

describe("DuplicateItems - MODIFIED strategy", () => {
  test("masterItem returns the item with the most recent dateModified", () => {
    const dup = new DuplicateItems([itemMiddle, itemOldest, itemNewest], MasterItem.MODIFIED);
    expect(dup.masterItem.id).toBe(itemNewest.id);
  });

  test("otherItems excludes the master", () => {
    const dup = new DuplicateItems([itemMiddle, itemOldest, itemNewest], MasterItem.MODIFIED);
    const otherIds = dup.otherItems.map((i) => i.id);
    expect(otherIds).not.toContain(itemNewest.id);
    expect(otherIds).toHaveLength(2);
  });
});

describe("DuplicateItems - DETAILED strategy", () => {
  test("masterItem returns the item with the most used fields", () => {
    const dup = new DuplicateItems([itemOldest, itemMiddle, itemNewest], MasterItem.DETAILED);
    // itemNewest has 3 used fields, most detailed
    expect(dup.masterItem.id).toBe(itemNewest.id);
  });

  test("breaks ties by oldest dateAdded", () => {
    const itemA = createMockItem({
      id: 40,
      dateAdded: "2020-05-01 00:00:00",
      usedFields: ["title", "author"],
    });
    const itemB = createMockItem({
      id: 50,
      dateAdded: "2023-05-01 00:00:00",
      usedFields: ["title", "author"],
    });
    const dup = new DuplicateItems([itemB, itemA], MasterItem.DETAILED);
    // Same field count, so the tiebreaker is oldest dateAdded
    expect(dup.masterItem.id).toBe(itemA.id);
  });

  test("otherItems excludes the master", () => {
    const dup = new DuplicateItems([itemOldest, itemMiddle, itemNewest], MasterItem.DETAILED);
    const otherIds = dup.otherItems.map((i) => i.id);
    expect(otherIds).not.toContain(itemNewest.id);
    expect(otherIds).toHaveLength(2);
  });
});

describe("DuplicateItems - lazy analysis and masterItemPref setter", () => {
  test("masterItem getter triggers lazy analyze on first access", () => {
    const dup = new DuplicateItems([itemNewest, itemOldest], MasterItem.OLDEST);
    // First access triggers analyze
    const master = dup.masterItem;
    expect(master.id).toBe(itemOldest.id);
  });

  test("masterItemPref setter resets and re-triggers analysis", () => {
    const dup = new DuplicateItems([itemNewest, itemOldest, itemMiddle], MasterItem.OLDEST);
    expect(dup.masterItem.id).toBe(itemOldest.id);

    // Change strategy to NEWEST
    dup.masterItemPref = MasterItem.NEWEST;
    expect(dup.masterItem.id).toBe(itemNewest.id);
  });

  test("items getter returns all items", () => {
    const dup = new DuplicateItems([itemOldest, itemMiddle, itemNewest], MasterItem.OLDEST);
    expect(dup.items).toHaveLength(3);
  });

  test("key returns smallest item ID", () => {
    const dup = new DuplicateItems([itemNewest, itemMiddle, itemOldest], MasterItem.OLDEST);
    expect(dup.key).toBe(itemOldest.id);
  });

  test("itemTitle returns display title of first item in constructor order", () => {
    const dup = new DuplicateItems([itemMiddle, itemOldest, itemNewest], MasterItem.OLDEST);
    expect(dup.itemTitle).toBe("Middle Item");
  });
});
