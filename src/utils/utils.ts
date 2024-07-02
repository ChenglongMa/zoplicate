import { waitUtilAsync } from "./wait";

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
) {
  const progress = new ztoolkit.ProgressWindow(title)
    .createLine({ text, progress: 100, type: "default" })
    .show(-1);
  // Just a placeholder
  progress.addDescription(`<a href="javascript:void(0)">${linkText}</a>`);

  await waitUtilAsync(() =>
    // @ts-ignore
    Boolean(progress.lines && progress.lines[0]._itemText),
  );
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
