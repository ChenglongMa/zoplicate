import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const repoRoot = join(__dirname, "..");

describe("M009 feature boundary", () => {
  test("old feature/module utility directories are absent", () => {
    expect(existsSync(join(repoRoot, "src/modules"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/utils"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/features/bulk-merge"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/features/non-duplicates"))).toBe(false);
  });

  test("Zotero notifier integration does not import features", () => {
    const source = readFileSync(join(repoRoot, "src/integrations/zotero/notifier.ts"), "utf8");
    expect(source).not.toMatch(/features\//);
    expect(source).not.toMatch(/\.\.\/\.\.\/features/);
  });

  test("window-scoped forbidden helpers are absent from feature and integration sources", () => {
    const files = [
      "src/features/bulkMerge/bulkMergeService.ts",
      "src/features/duplicates/duplicatePaneUI.ts",
      "src/integrations/zotero/duplicateSearch.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      expect(source).not.toMatch(/this\.win|private win|activeItemsView|activeCollectionsView/);
    }
  });
});
