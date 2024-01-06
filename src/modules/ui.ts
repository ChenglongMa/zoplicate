import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { getString } from "../utils/locale";
import { config } from "../../package.json";
import { Duplicates } from "./duplicates";
import { getPref } from "../utils/prefs";

export function registerUIElements(win: Window): void {
  const buttonID = "zoplicate-bulk-merge-button";
  const innerButtonID = buttonID + "-inner";
  const externalButtonID = buttonID + "-external";
  const button: TagElementProps = {
    tag: "button",
    attributes: {
      label: getString("bulk-merge-title"),
      image: `chrome://${config.addonRef}/content/icons/merge.png`,
    },
    namespace: "xul",
    listeners: [
      {
        type: "click",
        listener: async (e) => {
          ztoolkit.log("click count: ", Zotero.getActiveZoteroPane().itemsView.rowCount);
          if ((e.target as HTMLInputElement).disabled) return;
          const pref = getPref("bulk.master.item");
          const masterItem = getString(`bulk-merge-master-item-${pref}`);
          const text = `${getString("bulk-merge-message")}\n\n${getString("bulk-merge-sub-message", {
            args: { masterItem },
          })}\n${getString("bulk-merge-sub-message-2")}`;
          // https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prompt.js#L60
          // https://firefox-source-docs.mozilla.org/toolkit/components/prompts/prompts/nsIPromptService-reference.html#Prompter.confirmEx
          const result = Zotero.Prompt.confirm({
            window: win,
            title: getString("bulk-merge-title"),
            text: text,
            button0: Zotero.Prompt.BUTTON_TITLE_YES,
            button1: Zotero.Prompt.BUTTON_TITLE_CANCEL,
            checkLabel: "",
            checkbox: {},
          });
          if (result != 0) return;

          await Duplicates.bulkMergeDuplicates();
          await ZoteroPane.itemsView.runListeners('refresh');
        },
      },
    ],
    ignoreIfExists: true,
  };
  const msgID = "zoplicate-bulk-merge-message";
  const msgVBox: TagElementProps = {
    tag: "vbox",
    id: msgID,
    properties: {
      textContent: getString("duplicate-panel-message"),
    },
    ignoreIfExists: true,
  };
  const collectionsViewEvents = ZoteroPane.collectionsView.createEventBinding("select", false, true);
  collectionsViewEvents.addListener(() => {
    const mergeButton = win.document.getElementById("zotero-duplicates-merge-button") as Element;
    const groupBox = win.document.getElementById("zotero-item-pane-groupbox") as Element;
    const collectionTree = Zotero.getActiveZoteroPane().getCollectionTreeRow();

    if (collectionTree?.isDuplicates()) {
      ztoolkit.UI.appendElement(msgVBox, groupBox);
      button.id = innerButtonID;
      ztoolkit.UI.insertElementBefore(button, mergeButton);
      button.id = externalButtonID;
      ztoolkit.UI.appendElement(button, groupBox);
    } else {
      const externalButton = win.document.getElementById(externalButtonID);
      if (externalButton) {
        mergeButton.parentNode?.removeChild(win.document.getElementById(innerButtonID)!);
        groupBox.removeChild(win.document.getElementById(msgID)!);
        groupBox.removeChild(externalButton);
      }
    }
  });

  const itemTreeEvents = ZoteroPane.itemsView.createEventBinding("refresh", false, true);
  itemTreeEvents.addListener(() => {
    const externalButton = win.document.getElementById(externalButtonID);
    if (externalButton) {
      const disabled = Zotero.getActiveZoteroPane().itemsView.rowCount <= 0;
      externalButton.setAttribute("disabled", disabled.toString());
    }
  });
}
