import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("manual UI fixtures", () => {
  test("overflow duplicate RIS fixture contains many duplicate DOI pairs and long titles", () => {
    const ris = readFileSync(join(__dirname, "fixtures/zotero-duplicates-overflow.ris"), "utf-8");
    const entries = ris.match(/^TY {2}- /gm) ?? [];
    const dois = [...ris.matchAll(/^DO {2}- (.+)$/gm)].map((match) => match[1]);
    const doiCounts = new Map<string, number>();

    for (const doi of dois) {
      doiCounts.set(doi, (doiCounts.get(doi) ?? 0) + 1);
    }

    expect(entries).toHaveLength(60);
    expect(doiCounts.size).toBe(30);
    expect([...doiCounts.values()]).toEqual(Array(30).fill(2));
    expect(ris).toContain("extraordinarily long title designed to wrap");
  });
});
