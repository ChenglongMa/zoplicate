import { describe, expect, test } from "@jest/globals";
import {
  calculateLostFieldsForType,
  formatLostFieldsNote,
  isFieldValidForTargetType,
  selectOptimalTypeAndMaster,
} from "../src/shared/duplicates/typeLossOptimizer";
import { MasterItem } from "../src/shared/prefs";
import { createMockItem } from "./__setup__/globals";

describe("typeLossOptimizer - isFieldValidForTargetType", () => {
  test("same source and target type is always valid", () => {
    expect(isFieldValidForTargetType("volume", 1, 1)).toBe(true);
  });

  test("returns true if valid for target type", () => {
    // In our mock, type 1 supports volume (5)
    expect(isFieldValidForTargetType("volume", 2, 1)).toBe(true);
  });

  test("returns false if invalid for target type and no base conversion", () => {
    // In our mock, type 2 (preprint) does not support volume (5)
    expect(isFieldValidForTargetType("volume", 1, 2)).toBe(false);
  });
});

describe("typeLossOptimizer - calculateLostFieldsForType", () => {
  test("returns lost fields when target type cannot hold candidate fields", () => {
    // Item 1 is type 1 (journalArticle) with volume and pages
    const item1 = createMockItem({
      id: 1,
      itemTypeID: 1,
      usedFields: ["title", "volume", "pages"],
      fields: { title: "Title 1", volume: "42", pages: "100-110" },
      displayTitle: "Paper 1",
    });

    // Item 2 is type 2 (preprint) with title and DOI
    const item2 = createMockItem({
      id: 2,
      itemTypeID: 2,
      usedFields: ["title", "DOI"],
      fields: { title: "Title 2", DOI: "10.1234/test" },
      displayTitle: "Preprint 2",
    });

    // If target type is 2 (preprint), volume and pages from item1 are lost
    const lostForType2 = calculateLostFieldsForType([item1, item2], 2);
    expect(lostForType2).toHaveLength(2);
    expect(lostForType2.map((lf) => lf.fieldName)).toEqual(["volume", "pages"]);
    expect(lostForType2[0].value).toBe("42");
    expect(lostForType2[1].value).toBe("100-110");

    // If target type is 1 (journalArticle), nothing is lost because journalArticle supports all these fields
    const lostForType1 = calculateLostFieldsForType([item1, item2], 1);
    expect(lostForType1).toHaveLength(0);
  });

  test("skips system fields and empty values", () => {
    const item = createMockItem({
      id: 1,
      itemTypeID: 1,
      usedFields: ["id", "key", "version", "volume", "issue"],
      fields: { volume: "10", issue: "" }, // issue is empty, should be skipped
    });

    const lost = calculateLostFieldsForType([item], 2);
    expect(lost).toHaveLength(1);
    expect(lost[0].fieldName).toBe("volume");
  });
});

describe("typeLossOptimizer - selectOptimalTypeAndMaster", () => {
  test("picks the type that minimizes lost fields", () => {
    // Item A is journalArticle (type 1) with volume, issue, pages (3 fields that preprint lacks)
    const itemA = createMockItem({
      id: 10,
      itemTypeID: 1,
      dateAdded: "2024-02-01",
      usedFields: ["title", "volume", "issue", "pages"],
      fields: { title: "T", volume: "1", issue: "2", pages: "3-4" },
    });
    // Item B is preprint (type 2)
    const itemB = createMockItem({
      id: 20,
      itemTypeID: 2,
      dateAdded: "2024-01-01", // Older!
      usedFields: ["title", "DOI"],
      fields: { title: "T", DOI: "10.1234/5678" },
    });

    // Even though itemB is older, type 1 loses 0 fields whereas type 2 loses 3 fields.
    // Therefore, type 1 must be selected as optimalTypeID!
    const result = selectOptimalTypeAndMaster([itemB, itemA], MasterItem.OLDEST);
    expect(result.optimalTypeID).toBe(1);
    expect(result.masterItem.id).toBe(10);
    expect(result.lostFields).toHaveLength(0);
  });

  test("breaks ties using masterItemPref", () => {
    // Two items of different types, neither loses any field
    const itemA = createMockItem({
      id: 1,
      itemTypeID: 1,
      dateAdded: "2024-01-01",
      usedFields: ["title"],
      fields: { title: "Common" },
    });
    const itemB = createMockItem({
      id: 2,
      itemTypeID: 2,
      dateAdded: "2024-02-01",
      usedFields: ["title"],
      fields: { title: "Common" },
    });

    // If OLDEST, itemA (type 1) wins
    const oldestResult = selectOptimalTypeAndMaster([itemA, itemB], MasterItem.OLDEST);
    expect(oldestResult.optimalTypeID).toBe(1);
    expect(oldestResult.masterItem.id).toBe(1);

    // If NEWEST, itemB (type 2) wins
    const newestResult = selectOptimalTypeAndMaster([itemA, itemB], MasterItem.NEWEST);
    expect(newestResult.optimalTypeID).toBe(2);
    expect(newestResult.masterItem.id).toBe(2);
  });
});

describe("typeLossOptimizer - formatLostFieldsNote", () => {
  test("returns empty string when there are no lost fields", () => {
    expect(formatLostFieldsNote([])).toBe("");
  });

  test("generates html list of lost fields with escaping", () => {
    const html = formatLostFieldsNote([
      {
        fieldName: "volume",
        fieldLabel: "Volume",
        value: "42 <special>",
        sourceItemTitle: "My Article & Stuff",
        sourceItemType: "journalArticle",
        sourceItemID: 1,
      },
    ]);

    expect(html).toContain("<strong>Volume</strong>: 42 &lt;special&gt;");
    expect(html).toContain("My Article &amp; Stuff (journalArticle)");
    expect(html).toContain("<ul>");
    expect(html).toContain("</ul>");
  });
});
