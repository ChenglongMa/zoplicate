import { config } from "../../package.json";
import { Dialog } from "./dialog";
import { Action } from "../utils/action";

export class Notifier {
  static async whenAddItems(ids: Array<number>) {
    if (ids.length === 0) {
      return;
    }
    const duplicates = new Zotero.Duplicates(ZoteroPane.getSelectedLibraryID());
    const search = await duplicates.getSearchObject();
    await search.search();

    const duplicateMaps = ids.reduce((acc, id) => {
      const existingItemIDs: number[] = duplicates
        .getSetItemsByItemID(id)
        .filter((i: number) => i !== id);
      if (existingItemIDs.length > 0) {
        acc.set(id, { existingItemIDs, action: Action.CANCEL });
      }
      return acc;
    }, new Map<number, { existingItemIDs: number[]; action: string }>());

    // const duplicateMaps2 = ids
    //   .map((id) => ({
    //     newItemID: id,
    //     existingItemIDs: duplicates
    //       .getSetItemsByItemID(id)
    //       .filter((i: string | number) => i !== id),
    //     action: "cancel",
    //   }))
    //   .filter((i) => i.existingItemIDs.length > 0);

    if (duplicateMaps.size === 0) return;
    const dialog = await new Dialog().foundDuplicates(duplicateMaps);
  }

  static async whenAddItems2(ids: Array<string | number>) {
    // https://www.zotero.org/support/dev/client_coding/javascript_api
    // https://www.zotero.org/support/dev/client_coding/javascript_api/search_fields
    const id = ids[0];
    const item = (await Zotero.Items.getAsync(id)) as Zotero.Item;
    const title = item.getField("title") as string;
    const author = item.firstCreator;
    const date = item.getField("date");
    const url = item.getField("url");
    const doi = item.getField("DOI") as string;
    const isbn = item.getField("ISBN") as string;

    ztoolkit.log(
      "notify",
      id,
      title,
      author,
      date,
      url,
      doi,
      isbn,
      item.isRegularItem(),
      item.itemType,
      item.inPublications,
      item.dateAdded,
    );

    const s = new Zotero.Search({ libraryID: Zotero.Libraries.userLibraryID });

    if (doi) s.addCondition("DOI", "is", doi);
    if (isbn) s.addCondition("ISBN", "is", isbn);
    if (!doi && !isbn && title) s.addCondition("title", "is", title);

    const itemIDs = await s.search();
    if (itemIDs.length > 1) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: "Item already exists: " + title,
          type: "error",
          progress: 100,
        })
        .createLine({
          text: `Number of items: ${itemIDs.length}`,
          type: "error",
          progress: 100,
        })
        .show();
      return;
    }

    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: "Item Added: " + author,
        type: "success",
        progress: 100,
      })
      .show();
  }
}
