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
