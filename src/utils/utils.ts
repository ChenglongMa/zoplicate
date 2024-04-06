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
