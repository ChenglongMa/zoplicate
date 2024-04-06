import { DB } from "./db";
import { NonDuplicates } from "./nonDuplicates";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { removeSiblings } from "../utils/window";

export function patchNonDuplicates(db: DB) {
  const patch = new ztoolkit.Patch();
  patch.setData({
    target: Zotero.Duplicates.prototype,
    funcSign: "_findDuplicates",
    enabled: true,
    patcher: (original) =>
      async function (this: any) {
        NonDuplicates.getInstance().allNonDuplicates = await db.getNonDuplicates();
        await original.call(this);
      },
  });
  patch.setData({
    target: Zotero.DisjointSetForest.prototype,
    funcSign: "union",
    enabled: true,
    patcher: (original) =>
      function (this: any, x: { id: number }, y: { id: number }) {
        const allNonDuplicates = NonDuplicates.getInstance().allNonDuplicates;
        const pair = [x.id, y.id].sort().join(",");
        if (allNonDuplicates.has(pair)) {
          return;
        }
        original.call(this, x, y);
      },
  });
}

export function patchDuplicateTable() {
  const patch = new ztoolkit.Patch();
  patch.setData({
    target: Zotero.Duplicates.prototype,
    funcSign: "getSearchObject",
    enabled: true,
    patcher: (original) =>
      async function (this: any): Promise<Zotero.Search> {
        ztoolkit.log("Get Search Object is called.");
        if (addon.data.needResetDuplicateSearch || !addon.data.duplicateSearchObj) {
          ztoolkit.log("Reset duplicate search");
          addon.data.duplicateSearchObj = await original.call(this);
          addon.data.duplicateSets = this._sets;
          addon.data.needResetDuplicateSearch = false;
        }
        this._sets = addon.data.duplicateSets;

        // remove
        const s = addon.data.duplicateSearchObj!;
        for (let id in s.conditions) {
          let c = s.conditions[id];
          if (c.condition == "tempTable") {
            addon.data.tempTables.add(c.value);
            break;
          }
        }
        //
        return addon.data.duplicateSearchObj!;
      },
  });
}
