import { config } from "../../../package.json";
import { debug } from "../../shared/debug";
import { getString } from "../../shared/locale";
import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { areDuplicates } from "../../integrations/zotero/duplicateSearch";
import { getNonDuplicateSectionID, setNonDuplicateSectionID } from "../../app/state";
import { toggleNonDuplicates } from "./nonDuplicateActions";

interface DeferredPromise {
  promise: Promise<void>;
  resolve(): void;
  reject(reason?: unknown): void;
}

export function createDeferred(): DeferredPromise {
  let resolvePromise!: () => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

export function registerNonDuplicatesSection(db: NonDuplicatesDB) {
  unregisterNonDuplicatesSection();
  setNonDuplicateSectionID(
    Zotero.ItemPaneManager.registerSection({
      paneID: `non-duplicates-section`,
      pluginID: config.addonID,
      header: {
        icon: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`, //16x16
        l10nID: `${config.addonRef}-section-non-duplicate-header`,
      },
      sidenav: {
        icon: `chrome://${config.addonRef}/content/icons/non-duplicate.svg`, //20x20
        l10nID: `${config.addonRef}-section-non-duplicate-sidenav`,
      },

      sectionButtons: [
        {
          type: "add",
          icon: "chrome://zotero/skin/16/universal/plus.svg",
          l10nID: `${config.addonRef}-non-duplicate-add`,
          onClick: async ({ body, item }) => {
            ztoolkit.log("add non duplicate");
            const win = body.ownerDocument.defaultView;
            if (!win) return;

            const io: {
              dataIn: null | number[];
              dataOut: null | number[];
              deferred: DeferredPromise;
              itemTreeID: string;
              filterLibraryIDs: number[];
            } = {
              dataIn: null,
              dataOut: null,
              deferred: createDeferred(),
              itemTreeID: "non-duplicate-box-select-item-dialog",
              filterLibraryIDs: [item.libraryID],
            };
            win.openDialog(
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
            } else if (!(await areDuplicates(itemIDs, item.libraryID))) {
              message = "add-not-duplicates-alert-error-duplicates";
            }

            if (message !== "") {
              Zotero.alert(win, config.addonName, getString(message));
              return;
            }

            await toggleNonDuplicates("mark", itemIDs, item.libraryID, { win });
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
                // @ts-ignore - Zoplicate dispatches this custom notifier event.
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
        debug("onDestroy non duplicates");
        const notifierKey = body.dataset.notifierKey;
        if (notifierKey) {
          Zotero.Notifier.unregisterObserver(notifierKey);
        }
      },
      onItemChange: ({ body, item, setEnabled }) => {
        ztoolkit.log("onItemChange non duplicates", item);
        setEnabled(item?.isRegularItem());
        body.dataset.itemID = String(item.id);
      },
      onRender: ({ body, item, editable }) => {
        ztoolkit.log("onRender non duplicates", item);
      },
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
          const doc = body.ownerDocument;
          const row = doc.createElement("div");
          row.className = "row";

          const icon = ztoolkit
            .getGlobal("require")("components/icons")
            .getCSSItemTypeIcon(otherItem.getItemTypeIconName());

          const label = doc.createElement("span");
          label.className = "label";
          label.append(otherItem.getDisplayTitle());

          const box = doc.createElement("div");
          box.addEventListener("click", () =>
            (body.ownerDocument.defaultView as any).ZoteroPane.selectItem(otherItemID),
          );
          box.setAttribute("tabindex", "0");
          box.setAttribute("role", "button");
          box.setAttribute("aria-label", label.textContent ?? "");
          box.className = "box keyboard-clickable";
          box.appendChild(icon);
          box.appendChild(label);
          row.append(box);

          if (editable) {
            // @ts-ignore - Zotero's chrome document exposes XUL element creation.
            const remove = doc.createXULElement("toolbarbutton");
            remove.addEventListener("command", () => {
              const itemIDs = [item.id, otherItemID];
              toggleNonDuplicates("unmark", itemIDs, item.libraryID, { win: body.ownerDocument.defaultView! });
            });
            remove.className = "zotero-clicky zotero-clicky-minus";
            remove.setAttribute("data-l10n-id", "section-button-remove");
            remove.setAttribute("tabindex", "0");
            row.append(remove);
          }
          body.append(row);
        }
      },
    }),
  );
}

export function unregisterNonDuplicatesSection() {
  const sectionID = getNonDuplicateSectionID();
  if (sectionID) {
    Zotero.ItemPaneManager.unregisterSection(sectionID);
    setNonDuplicateSectionID(false);
  }
}
