export function debug(...args: any[]) {
  Zotero.debug(
    "[zoplicate] " +
      args
        .map((d: any) => {
          try {
            return typeof d === "object" ? JSON.stringify(d) : String(d);
          } catch (e) {
            Zotero.debug(d);
            return "";
          }
        })
        .join("\n"),
  );
}
