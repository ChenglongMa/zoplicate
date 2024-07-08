import { config } from "../../package.json";
import { isInDuplicatesPane, refreshItemTree } from "../utils/zotero";
import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { areDuplicates, fetchDuplicates } from "./duplicates";
import { NonDuplicatesDB } from "../db/nonDuplicates";

export function registerNonDuplicatesSection(db: NonDuplicatesDB) {
  addon.data.nonDuplicateSectionID = Zotero.ItemPaneManager.registerSection({
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
    //     bodyXHTML: `
    // <linkset>
    //     <html:link rel="localization" href="${config.addonRef}-itemSection.ftl" />
    // </linkset>
    // `,

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
            filterLibraryIDs: number[];
          } = {
            dataIn: null,
            dataOut: null,
            deferred: Zotero.Promise.defer(),
            itemTreeID: "non-duplicate-box-select-item-dialog",
            filterLibraryIDs: [item.libraryID],
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

          if (new Set(itemIDs).size < 2) {
            return;
          }

          let message: string = "";
          const libraryIDs = new Set(itemIDs.map((item) => Zotero.Items.get(item).libraryID));

          if (libraryIDs.size > 1) {
            message = "add-not-duplicates-alert-error-diff-library";
          } else if (await db.existsNonDuplicates(itemIDs)) {
            message = "add-not-duplicates-alert-error-exist";
          } else if (!(await areDuplicates(itemIDs))) {
            message = "add-not-duplicates-alert-error-duplicates";
          }

          if (message !== "") {
            Zotero.alert(body.ownerDocument.defaultView!, config.addonName, getString(message));
            return;
          }

          await toggleNonDuplicates("mark", itemIDs);
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
            const itemID = body.dataset.itemID;
            const item = itemID && Zotero.Items.get(itemID);
            ztoolkit.log(`non duplicate notify ${type}`, ids, item);
            if (
              item &&
              // @ts-ignore
              event === "refreshNonDuplicate" &&
              type === "item" &&
              (ids as number[]).includes(item.id)
            ) {
              ztoolkit.log(`non duplicate notify [removeNonDuplicate] ${type}`, ids, item.id);
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
      body.dataset.itemID = String(item.id);
    },
    onRender: () => {},
    onAsyncRender: async ({ body, item, editable }) => {
      ztoolkit.log("onAsyncRender non duplicates", body);

      body.replaceChildren();

      const duplicateItems = await db.getNonDuplicates({ itemID: item.id });
      for (const { itemID, itemID2 } of duplicateItems) {
        const otherItemID = itemID === item.id ? itemID2 : itemID;
        const otherItem = Zotero.Items.get(otherItemID);

        if (!otherItem || otherItem.deleted) {
          continue;
        }

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
            const itemIDs = [item.id, otherItemID];
            toggleNonDuplicates("unmark", itemIDs);
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

export async function toggleNonDuplicates(action: "mark" | "unmark", items?: number[] | Zotero.Item[]) {
  const selectedItems = items && items.length ? items : Zotero.getActiveZoteroPane().getSelectedItems();
  const itemIDs = selectedItems.map((item) => (typeof item === "number" ? item : item.id));
  if (action === "mark") {
    await NonDuplicatesDB.instance.insertNonDuplicates(itemIDs, ZoteroPane.getSelectedLibraryID());
  } else if (action === "unmark") {
    await NonDuplicatesDB.instance.deleteNonDuplicates(itemIDs);
  }
  await fetchDuplicates({ refresh: true });
  if (isInDuplicatesPane()) {
    refreshItemTree();
  }
  await Zotero.Notifier.trigger(
    // @ts-ignore
    "refreshNonDuplicate",
    "item",
    itemIDs,
    {},
    true,
  );
}

export function createNonDuplicateButton(id: string, showing = true): TagElementProps {
  return {
    tag: "button",
    id: id,
    attributes: {
      label: getString("menuitem-not-duplicate"),
      image: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`,
      hidden: !showing,
    },
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
  public static readonly nonDuplicateButtonID = "non-duplicates-button";
  public static readonly innerButtonID = this.nonDuplicateButtonID + "-inner";
  public static readonly externalButtonID = this.nonDuplicateButtonID + "-external";

  private constructor() {}

  public static getInstance(): NonDuplicates {
    if (!NonDuplicates._instance) {
      NonDuplicates._instance = new NonDuplicates();
    }
    return NonDuplicates._instance;
  }
}
