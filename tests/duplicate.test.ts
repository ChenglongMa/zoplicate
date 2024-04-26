import { expect, test } from "@jest/globals";
import { DuplicateItems } from "../src/modules/duplicateItems";
import { MasterItem } from "../src/utils/prefs";
// import { Zotero } from "zotero-types";

test("Identify master item and other items as duplicates", () => {
  const masterItem = {
    dateAdded: new Date(),
    dateModified: new Date(),
  };
  const otherItem = {
    id: 2,
    name: "Master Item",
    price: 100,
  };
  const duplicateItems = new DuplicateItems(
    [masterItem, otherItem],
    MasterItem.OLDEST,
  );
  expect(masterItem).toEqual(otherItem);
});
