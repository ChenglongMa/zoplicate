import { config } from "../../../package.json";
import type { TagElementProps } from "zotero-plugin-toolkit";
import { getString } from "../../shared/locale";
import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { fetchDuplicates } from "../../integrations/zotero/duplicateSearch";
import { menuCache } from "../../integrations/zotero/menuCache";
import {
  getSelectedItems,
  getSelectedLibraryID,
  isInDuplicatesPane,
  refreshItemTree,
} from "../../integrations/zotero/windows";
import {
  NON_DUPLICATE_BUTTON_ID,
  NON_DUPLICATE_INNER_BUTTON_ID,
  NON_DUPLICATE_EXTERNAL_BUTTON_ID,
} from "../../shared/duplicates/duplicateButtonIDs";

interface ToggleNonDuplicatesOptions {
  win?: Window;
}

export async function toggleNonDuplicates(
  action: "mark" | "unmark",
  items: number[] | Zotero.Item[],
  libraryID?: number,
  options: ToggleNonDuplicatesOptions = {},
) {
  const resolvedItems = items.map((item) => (typeof item === "number" ? Zotero.Items.get(item) : item));
  const itemIDs = resolvedItems.map((item) => item.id);
  const resolvedLibraryID = libraryID ?? resolvedItems[0]?.libraryID;

  if (resolvedLibraryID === undefined) {
    return;
  }

  if (action === "mark") {
    await NonDuplicatesDB.instance.insertNonDuplicates(itemIDs, resolvedLibraryID);
  } else if (action === "unmark") {
    await NonDuplicatesDB.instance.deleteNonDuplicates(itemIDs);
  }

  await fetchDuplicates({ libraryID: resolvedLibraryID, refresh: true });
  menuCache.invalidateAll();
  if (options.win && isInDuplicatesPane(options.win)) {
    refreshItemTree(options.win);
  }
  await Zotero.Notifier.trigger(
    // @ts-ignore - Zoplicate dispatches this custom notifier event.
    "refreshNonDuplicate",
    "item",
    itemIDs,
    {},
    true,
  );
}

export async function toggleSelectedNonDuplicates(action: "mark" | "unmark", win: Window) {
  await toggleNonDuplicates(action, getSelectedItems(win), getSelectedLibraryID(win), { win });
}

export function createNonDuplicateButton(win: Window, id: string, showing = true): TagElementProps {
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
          await toggleSelectedNonDuplicates("mark", win);
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
