export function truncateString(inputString: string, maxLength: number = 24): string {
  if (inputString.length <= maxLength) {
    return inputString;
  } else {
    return inputString.slice(0, maxLength) + "...";
  }
}
