import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

interface ZoteroManifest {
  applications?: {
    zotero?: {
      strict_max_version?: string;
    };
  };
}

// Update this only after Zotero announces the next major version's feature freeze
// on zotero-dev and Zoplicate has completed compatibility verification.
// Zotero 10 feature-freeze announcement (2026-07-29):
// https://groups.google.com/g/zotero-dev/c/KqkZGjYHcJs/m/LS6ZO23WAwAJ
const LATEST_FEATURE_FROZEN_ZOTERO_MAJOR = 10;

describe("Zotero manifest compatibility policy", () => {
  test("does not declare compatibility beyond the latest feature-frozen major", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "../addon/manifest.json"), "utf8")) as ZoteroManifest;
    const strictMaxVersion = manifest.applications?.zotero?.strict_max_version;

    expect(strictMaxVersion).toBeDefined();
    const match = strictMaxVersion?.match(/^(\d+)(?:\.0)?\.\*$/);
    expect(match).not.toBeNull();
    if (!match) {
      return;
    }

    expect(Number(match[1])).toBeLessThanOrEqual(LATEST_FEATURE_FROZEN_ZOTERO_MAJOR);
  });
});
