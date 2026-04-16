import { describe, expect, test } from "@jest/globals";
import {
  unionMergePairs,
} from "../src/integrations/zotero/syncedSettingsStore";

describe("unionMergePairs", () => {
  test("returns union of two disjoint pair arrays", () => {
    const local: [string, string][] = [["A", "B"]];
    const remote: [string, string][] = [["C", "D"]];
    const result = unionMergePairs(local, remote);
    expect(result).toEqual([["A", "B"], ["C", "D"]]);
  });

  test("deduplicates overlapping pairs", () => {
    const local: [string, string][] = [["A", "B"], ["C", "D"]];
    const remote: [string, string][] = [["A", "B"], ["E", "F"]];
    const result = unionMergePairs(local, remote);
    expect(result).toEqual([["A", "B"], ["C", "D"], ["E", "F"]]);
  });

  test("normalizes reversed pairs before dedup", () => {
    const local: [string, string][] = [["B", "A"]];
    const remote: [string, string][] = [["A", "B"]];
    const result = unionMergePairs(local, remote);
    expect(result).toEqual([["A", "B"]]);
  });

  test("handles empty local", () => {
    const result = unionMergePairs([], [["X", "Y"]]);
    expect(result).toEqual([["X", "Y"]]);
  });

  test("handles empty remote", () => {
    const result = unionMergePairs([["X", "Y"]], []);
    expect(result).toEqual([["X", "Y"]]);
  });

  test("handles both empty", () => {
    const result = unionMergePairs([], []);
    expect(result).toEqual([]);
  });

  test("result is sorted by first key, then second key", () => {
    const local: [string, string][] = [["Z", "Y"]];
    const remote: [string, string][] = [["A", "B"], ["A", "C"]];
    const result = unionMergePairs(local, remote);
    expect(result).toEqual([["A", "B"], ["A", "C"], ["Y", "Z"]]);
  });
});
