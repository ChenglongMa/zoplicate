import { describe, expect, test, jest, beforeAll, it, afterAll, afterEach } from "@jest/globals";
import { cleanISBNString } from "../src/utils/utils";

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
