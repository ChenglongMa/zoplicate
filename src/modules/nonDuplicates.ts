import { SQLiteDB } from "./db";
import { patchFindDuplicates } from "./patcher";
import { config } from "../../package.json";
import { isInDuplicatesPane, refreshItemTree } from "../utils/zotero";
import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { areDuplicates, fetchDuplicates } from "./duplicates";

export function registerNonDuplicatesSection(db: SQLiteDB) {
  const key = Zotero.ItemPaneManager.registerSection({
    paneID: `sec-non-duplicates`,
    pluginID: config.addonID,
    header: {
      icon: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`, //16x16
      l10nID: `${config.addonRef}-section-non-duplicate-header`,
    },
    sidenav: {
      icon: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`, //20x20
      l10nID: `${config.addonRef}-section-non-duplicate-sidenav`,
    },
    bodyXHTML: `
<linkset>
    <html:link rel="localization" href="${config.addonRef}-itemSection.ftl" />
</linkset>
`,

    sectionButtons: [
      {
        type: "add",
        icon: "chrome://zotero/skin/16/universal/plus.svg",
        l10nID: `${config.addonRef}-non-duplicate-add`,
        onClick: async ({ body, item }) => {
          ztoolkit.log("add non duplicate");
          let io: {
            dataIn: null | number[];
            dataOut: null | number[];
            deferred: any;
            itemTreeID: string;
          } = {
            dataIn: null,
            dataOut: null,
            deferred: Zotero.Promise.defer(),
            itemTreeID: "non-duplicate-box-select-item-dialog",
          };
          window.openDialog(
            "chrome://zotero/content/selectItemsDialog.xhtml",
            "",
            "chrome,dialog=no,centerscreen,resizable=yes",
            io,
          );
          await io.deferred.promise;
          ztoolkit.log("io.dataOut", io);

          if (!io.dataOut || !io.dataOut.length) {
            return;
          }
          const itemIDs = [...io.dataOut, item.id];
          if (!(await areDuplicates(itemIDs))) {
            Zotero.alert(
              body.ownerDocument.defaultView!,
              config.addonName,
              getString("add-not-duplicates-alert-error"),
            );
            return;
          }

          // TODO: exist?
          await toggleNonDuplicates("mark", itemIDs);

          // let relItems = await Zotero.Items.getAsync(io.dataOut);
          // if (!relItems.length) {
          //   return;
          // }
          // if (relItems[0].libraryID != item.libraryID) {
          //   Zotero.alert(body.ownerDocument.defaultView!, "", "You cannot relate items in different libraries.");
          //   return;
          // }
          // await Zotero.DB.executeTransaction(async () => {
          //   for (let relItem of relItems) {
          //     if (this._item.addRelatedItem(relItem)) {
          //       await this._item.save({
          //         skipDateModifiedUpdate: true
          //       });
          //     }
          //     if (relItem.addRelatedItem(this._item)) {
          //       await relItem.save({
          //         skipDateModifiedUpdate: true
          //       });
          //     }
          //   }
          // });
          // End of OnClick
        },
      },
    ],
    onInit({
      paneID,
      doc,
      body,
      item,
      editable,
      tabType,
      setL10nArgs,
      setEnabled,
      setSectionSummary,
      setSectionButtonStatus,
      refresh,
    }) {
      ztoolkit.log("onInit non duplicates");

      const notifierKey = Zotero.Notifier.registerObserver(
        {
          notify: (event, type, ids, extraData) => {
            // const item = Zotero.Items.get(body.dataset.itemID || "");
            if (
              item &&
              // @ts-ignore
              event === "updateNonDuplicates" &&
              type === "item" &&
              (ids as number[]).includes(item.id)
            ) {
              ztoolkit.log(
                `non duplicate notify update ${type}`,
                ids,
                item.id,
              );
              refresh();
            }
          },
        },
        ["item"],
      );
      body.classList.add("non-duplicate-box");
      body.classList.add("body");
      body.dataset.notifierKey = notifierKey;
    },
    onDestroy({ body }) {
      ztoolkit.log("onDestroy non duplicates");
      const notifierKey = body.dataset.notifierKey;
      if (notifierKey) {
        Zotero.Notifier.unregisterObserver(notifierKey);
      }
    },
    onItemChange: ({ body, item, setEnabled }) => {
      ztoolkit.log("onItemChange non duplicates");
      // if (body.closest("bn-workspace") as HTMLElement | undefined) {
      //   setEnabled(true);
      //   body.dataset.itemID = String(item.id);
      //   return;
      // }
      // setEnabled(false);
    },
    onRender: () => {},
    onAsyncRender: async ({ body, item, editable }) => {
      // await renderGraph(body, item);

      ztoolkit.log("onAsyncRender non duplicates", body);

      body.replaceChildren();

      const duplicateItems = await db.getNonDuplicates(item.id);
      for (const { itemID, itemID2 } of duplicateItems) {
        const otherItemID = itemID === item.id ? itemID2 : itemID;
        const otherItem = Zotero.Items.get(otherItemID);

        let row = document.createElement("div");
        row.className = "row";

        const icon = ztoolkit
          .getGlobal("require")("components/icons")
          .getCSSItemTypeIcon(otherItem.getItemTypeIconName());

        let label = document.createElement("span");
        label.className = "label";
        label.append(otherItem.getDisplayTitle());

        let box = document.createElement("div");
        box.addEventListener("click", () => Zotero.getActiveZoteroPane().selectItem(otherItemID));
        box.setAttribute("tabindex", "0");
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", label.textContent ?? "");
        box.className = "box keyboard-clickable";
        box.appendChild(icon);
        box.appendChild(label);
        row.append(box);

        if (editable) {
          // @ts-ignore
          let remove = document.createXULElement("toolbarbutton");
          remove.addEventListener("command", () => {
            toggleNonDuplicates("unmark", [item.id, otherItemID]);
          });
          remove.className = "zotero-clicky zotero-clicky-minus";
          remove.setAttribute("data-l10n-id", "section-button-remove");
          remove.setAttribute("tabindex", "0");
          row.append(remove);
        }
        body.append(row);
      }
    },
  });
}

export async function toggleNonDuplicates(
  action: "mark" | "unmark",
  items: undefined | number[] | Zotero.Item[] = undefined,
) {
  const selectedItems = items && items.length ? items : Zotero.getActiveZoteroPane().getSelectedItems();
  const itemIDs = selectedItems.map((item) => (typeof item === "number" ? item : item.id));
  if (action === "mark") {
    await SQLiteDB.getInstance().insertNonDuplicates(itemIDs);
  } else if (action === "unmark") {
    await SQLiteDB.getInstance().deleteNonDuplicates(itemIDs);
  }
  await fetchDuplicates({ refresh: true });
  if (isInDuplicatesPane()) {
    refreshItemTree();
  }
}

export function createNonDuplicateButton(): TagElementProps {
  return {
    tag: "button",
    id: "non-duplicates-button",
    attributes: {
      label: getString("menuitem-not-duplicate"),
      image: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`,
      disabled: false,
    },
    classList: ["duplicate-box-button"],
    namespace: "xul",
    listeners: [
      {
        type: "click",
        listener: async (e) => {
          await toggleNonDuplicates("mark");
        },
      },
    ],
    ignoreIfExists: true,
  };
}

export class NonDuplicates {
  private static _instance: NonDuplicates;

  public allNonDuplicates: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): NonDuplicates {
    if (!NonDuplicates._instance) {
      NonDuplicates._instance = new NonDuplicates();
    }
    return NonDuplicates._instance;
  }

  init(db: SQLiteDB) {
    patchFindDuplicates(db);
  }
}
