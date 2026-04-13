import { config } from "../../../package.json";
import { isInDuplicatesPane, refreshItemTree } from "../../shared/zotero";
import type { TagElementProps } from "zotero-plugin-toolkit";
import { getString } from "../../shared/locale";
import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { fetchDuplicates } from "../../shared/duplicateQueries";
import { menuCache } from "../../integrations/zotero/menuCache";
import {
  NON_DUPLICATE_BUTTON_ID,
  NON_DUPLICATE_INNER_BUTTON_ID,
  NON_DUPLICATE_EXTERNAL_BUTTON_ID,
} from "../../shared/duplicates/duplicateButtonIDs";

export async function toggleNonDuplicates(action: "mark" | "unmark", items?: number[] | Zotero.Item[], libraryID?: number) {
  const selectedItems = items && items.length ? items : Zotero.getActiveZoteroPane().getSelectedItems();
  const itemIDs = selectedItems.map((item) => (typeof item === "number" ? item : item.id));
  if (action === "mark") {
    const libID = libraryID ?? Zotero.getActiveZoteroPane().getSelectedLibraryID();
    await NonDuplicatesDB.instance.insertNonDuplicates(itemIDs, libID);
  } else if (action === "unmark") {
    await NonDuplicatesDB.instance.deleteNonDuplicates(itemIDs);
  }
  await fetchDuplicates({ refresh: true });
  menuCache.invalidateAll();
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
  public static readonly nonDuplicateButtonID = NON_DUPLICATE_BUTTON_ID;
  public static readonly innerButtonID = NON_DUPLICATE_INNER_BUTTON_ID;
  public static readonly externalButtonID = NON_DUPLICATE_EXTERNAL_BUTTON_ID;

  private constructor() {}

  public static getInstance(): NonDuplicates {
    if (!NonDuplicates._instance) {
      NonDuplicates._instance = new NonDuplicates();
    }
    return NonDuplicates._instance;
  }
}
