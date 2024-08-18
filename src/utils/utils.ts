import { waitUntilAsync } from "./wait";

export function truncateString(inputString: string, maxLength: number = 24): string {
  if (inputString.length <= maxLength) {
    return inputString;
  } else {
    return inputString.slice(0, maxLength) + "...";
  }
}

export function hasOwnProperty(obj: { [key: string | number]: any }, key: string | number): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function unique2D<T>(array: T[][]): T[][] {
  return array.filter((value, index, self) => self.findIndex((v) => v.join() === value.join()) === index);
}

export function uniqueItemPairs(itemPairs: { itemID: number; itemID2: number }[]): {
  itemID: number;
  itemID2: number;
}[] {
  const hashMap: { [key: string]: boolean } = {};
  const uniqueRecords: { itemID: number; itemID2: number }[] = [];

  for (const record of itemPairs) {
    const key = `${record.itemID}-${record.itemID2}`;
    if (!hashMap[key]) {
      hashMap[key] = true;
      uniqueRecords.push(record);
    }
  }
  return uniqueRecords;
}

// Refer to https://github.com/windingwind/zotero-better-notes/blob/master/src/utils/hint.ts#L18-L43
export async function showHintWithLink(
  title: string,
  text: string,
  linkText: string,
  linkCallback: (ev: MouseEvent) => any,
  closeTime: number | undefined = 15000, // time unit: ms
) {
  const progress = new ztoolkit.ProgressWindow(title)
    .createLine({
      text,
      progress: 100,
      type: "default",
    })
    .show(closeTime);
  progress.addDescription(`<a href="javascript:void(0)">${linkText}</a>`);

  try {
    await waitUntilAsync(() =>
      // @ts-ignore
      Boolean(progress.lines && progress.lines[0]._itemText),
    );
  } catch (e) {
    // Do nothing
  }

  // @ts-ignore
  progress.lines[0]._hbox.ownerDocument
    .querySelector("label[href]")
    .addEventListener("click", async (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      linkCallback(ev);
    });
  return progress;
}

export function normalizeString(input: string, wildcard = "%") {
  // Replace all non-letter and non-space characters with a wildcard character
  // Use a regular expression to match one or more occurrences of non-letter and non-space characters
  // and replace them with a single wildcard character
  // return ("" + input).replace(/[^a-zA-Z\s]+/g, wildcard);
  return ("" + input)
    .replace(/[^a-zA-Z]+/g, wildcard)
    .trim()
    .toUpperCase(); // Ignore non-letter characters
}

/**
 * Clean creator name.
 * Check the specific length of the creator's name characters and replace the rest with a wildcard character.
 * @param creator
 * @param checkLength
 * @param wildcard
 */
export function cleanCreator(
  creator: Zotero.Item.Creator,
  checkLength = 2,
  wildcard = "%",
): {
  lastName: string;
  firstName: string;
} {
  const lastName = creator.lastName ? normalizeString(creator.lastName.slice(0, checkLength) + wildcard, wildcard) : "";
  const firstName = creator.firstName
    ? normalizeString(creator.firstName.slice(0, checkLength) + wildcard, wildcard)
    : "";
  return { lastName, firstName };
}

export function cleanDOI(item: Zotero.Item): string[] {
  const possibleDOIFields: Zotero.Item.ItemField[] = ["DOI", "url"];
  const doiStrs = new Set<string>();
  for (const field of possibleDOIFields) {
    let cleanedDOI = Zotero.Utilities.cleanDOI("" + item.getField(field));
    cleanedDOI && doiStrs.add(cleanedDOI.trim().toUpperCase());
    cleanedDOI = Zotero.Utilities.cleanDOI("" + item.getExtraField(field));
    cleanedDOI && doiStrs.add(cleanedDOI.trim().toUpperCase());
  }
  return Array.from(doiStrs);
}

export function cleanISBN(item: Zotero.Item): string[] {
  const possibleISBNFields: Zotero.Item.ItemField[] = ["DOI", "ISBN", "url"];
  let isbnString = "";
  for (const field of possibleISBNFields) {
    isbnString += item.getField(field) + " ";
    isbnString += item.getExtraField(field) + " ";
  }
  return cleanISBNString(isbnString.trim());
}

export function cleanISBNString(isbnStr?: string): string[] {
  if (!isbnStr?.trim()) {
    return [];
  }
  isbnStr = isbnStr.toUpperCase().replace(/[\x2D\xAD\u2010-\u2015\u2043\u2212]+/g, ""); // Ignore dashes
  const isbnRE = /\b(?:97[89]\s*(?:\d\s*){9}\d|(?:\d\s*){9}[\dX])(?=\D|$)/g;
  const matches = isbnStr.match(isbnRE);
  if (!matches) {
    return [];
  }
  const isbns = new Set(matches.map((isbn) => isbn.replace(/\s+/g, "").replace(/^978/, "")));
  return Array.from(isbns);
}
