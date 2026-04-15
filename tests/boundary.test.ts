import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const repoRoot = join(__dirname, "..");

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkTsFiles(fullPath);
    }
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

function resolveRelativeImport(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const base = join(file, "..", specifier);
  const candidates = [base + ".ts", join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

describe("M009 feature boundary", () => {
  test("old feature/module utility directories are absent", () => {
    expect(existsSync(join(repoRoot, "src/modules"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/utils"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/features/bulk-merge"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/features/non-duplicates"))).toBe(false);
  });

  test("app hooks stays a composition root", () => {
    const source = readFileSync(join(repoRoot, "src/app/hooks.ts"), "utf8");
    expect(source).not.toMatch(/ItemTreeManager\.registerColumns/);
    expect(source).not.toMatch(/registerDevColumn/);
  });

  test("app has no barrel export", () => {
    expect(existsSync(join(repoRoot, "src/app/index.ts"))).toBe(false);
  });

  test("Zotero notifier integration does not import features", () => {
    const source = readFileSync(join(repoRoot, "src/integrations/zotero/notifier.ts"), "utf8");
    expect(source).not.toMatch(/features\//);
    expect(source).not.toMatch(/\.\.\/\.\.\/features/);
  });

  test("feature directories do not import other feature directories", () => {
    const featuresRoot = join(repoRoot, "src/features");
    const featureDirs = readdirSync(featuresRoot).filter((entry) => statSync(join(featuresRoot, entry)).isDirectory());
    const violations: string[] = [];
    const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

    for (const feature of featureDirs) {
      for (const file of walkTsFiles(join(featuresRoot, feature))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(importPattern)) {
          const resolved = resolveRelativeImport(file, match[1]);
          if (!resolved || !resolved.startsWith(featuresRoot)) {
            continue;
          }
          const targetFeature = resolved.slice(featuresRoot.length + 1).split("/")[0];
          if (targetFeature !== feature) {
            violations.push(`${file.slice(repoRoot.length + 1)} -> ${resolved.slice(repoRoot.length + 1)}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
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
