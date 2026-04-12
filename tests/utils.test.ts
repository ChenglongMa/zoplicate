import { describe, expect, test, jest, beforeAll, it, afterAll, afterEach } from "@jest/globals";
import { cleanISBNString, truncateString, normalizeString, cleanCreator, cleanDOI, unique, unique2D } from "../src/utils/utils";
import { createMockItem } from "./__setup__/globals";

describe("Clean ISBN values", () => {
  test("Extract valid ISBN values from strings", () => {
    const isbn = "invalid ISBN 10.1007/978-0-387-85820-3_1";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["0387858203"]);
  });
  test("Extract valid ISBN values from urls", () => {
    const isbn = "https://link.springer.com/book/10.1007/978-0-387-85820-3";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["0387858203"]);
  });

  test("Extract multiple valid ISBN values from strings", () => {
    const isbn = "978-3-16-148410-0, 978-3-16-148410-1";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["3161484100", "3161484101"]);
  });

  test("Extract valid ISBN values from strings with multiple spaces", () => {
    const isbn = "978-3-16-148410-0,  978-3-16-148410-1";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["3161484100", "3161484101"]);
  });

  test("Extract valid ISBN values from strings with multiple dashes", () => {
    const isbn = "978-3-16-148410-0, 978-3-16-148410-1";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["3161484100", "3161484101"]);
  });

  test("Extract valid ISBN values from strings with different format of dashes", () => {
    const isbn = "978\x2D3-16-148410\x2d0, 978\xAD3–16\u2015148410–1";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["3161484100", "3161484101"]);
  });

  test("Extract UNIQUE valid ISBN values from strings", () => {
    const isbn = "978-3-16-148410-0, 978-3-16-148410-0";
    const isbns = cleanISBNString(isbn);
    expect(isbns).toEqual(["3161484100"]);
  });
});

describe("truncateString", () => {
  test("returns string unchanged when shorter than maxLength", () => {
    expect(truncateString("short", 10)).toBe("short");
  });

  test("returns string unchanged when exactly maxLength", () => {
    expect(truncateString("abcd", 4)).toBe("abcd");
  });

  test("truncates and adds ellipsis when longer than maxLength", () => {
    expect(truncateString("a long string that exceeds the limit", 10)).toBe("a long str...");
  });

  test("uses default maxLength of 24", () => {
    const input = "this string is definitely longer than twenty four characters";
    const result = truncateString(input);
    expect(result).toBe(input.slice(0, 24) + "...");
  });
});

describe("normalizeString", () => {
  test("replaces non-letter characters with wildcard and uppercases", () => {
    expect(normalizeString("hello-world")).toBe("HELLO%WORLD");
  });

  test("uses custom wildcard", () => {
    expect(normalizeString("test123value", "*")).toBe("TEST*VALUE");
  });

  test("handles empty string", () => {
    expect(normalizeString("")).toBe("");
  });

  test("replaces leading/trailing spaces with wildcard", () => {
    // Spaces are non-letter, so they become wildcards; .trim() only strips whitespace
    expect(normalizeString(" abc ")).toBe("%ABC%");
  });
});

describe("cleanCreator", () => {
  test("cleans creator name with default parameters", () => {
    const creator = { lastName: "Smith", firstName: "John" } as any;
    const result = cleanCreator(creator);
    expect(result.lastName).toBe("SM%");
    expect(result.firstName).toBe("JO%");
  });

  test("handles empty firstName", () => {
    const creator = { lastName: "Doe", firstName: "" } as any;
    const result = cleanCreator(creator);
    expect(result.lastName).toBe("DO%");
    expect(result.firstName).toBe("");
  });

  test("handles undefined firstName and lastName", () => {
    const creator = { lastName: undefined, firstName: undefined } as any;
    const result = cleanCreator(creator);
    expect(result.lastName).toBe("");
    expect(result.firstName).toBe("");
  });
});

describe("cleanDOI", () => {
  test("extracts DOI from item DOI field", () => {
    const item = createMockItem({
      fields: { DOI: "10.1234/test.doi" },
    });
    const result = cleanDOI(item);
    expect(result).toEqual(["10.1234/TEST.DOI"]);
  });

  test("extracts DOI from item url field", () => {
    const item = createMockItem({
      fields: { url: "https://doi.org/10.5678/another.doi" },
    });
    const result = cleanDOI(item);
    expect(result).toEqual(["10.5678/ANOTHER.DOI"]);
  });

  test("returns empty array when no DOI found", () => {
    const item = createMockItem({
      fields: { DOI: "", url: "https://example.com" },
    });
    const result = cleanDOI(item);
    expect(result).toEqual([]);
  });

  test("deduplicates DOIs from multiple fields", () => {
    const item = createMockItem({
      fields: { DOI: "10.1234/same.doi", url: "https://doi.org/10.1234/same.doi" },
    });
    const result = cleanDOI(item);
    expect(result).toEqual(["10.1234/SAME.DOI"]);
  });
});

describe("unique", () => {
  test("removes duplicate primitives", () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  test("returns empty array for empty input", () => {
    expect(unique([])).toEqual([]);
  });
});

describe("unique2D", () => {
  test("removes duplicate sub-arrays by join comparison", () => {
    const input = [
      [1, 2],
      [3, 4],
      [1, 2],
    ];
    expect(unique2D(input)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(unique2D([])).toEqual([]);
  });
});
