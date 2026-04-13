import type { TagElementProps } from "zotero-plugin-toolkit";
import { toggleButtonHidden } from "../../shared/view";
import { isInDuplicatesPane, activeItemsView } from "../../shared/zotero";
import { areDuplicates } from "../../shared/duplicateQueries";
import {
  BULK_MERGE_INNER_BUTTON_ID,
  BULK_MERGE_EXTERNAL_BUTTON_ID,
  NON_DUPLICATE_INNER_BUTTON_ID,
  NON_DUPLICATE_EXTERNAL_BUTTON_ID,
} from "../../shared/duplicates/duplicateButtonIDs";

function addButtonsInDuplicatePanes(
  innerButton: boolean,
  siblingElement: Element,
  bulkButtonFactory: (win: Window, id: string) => TagElementProps,
  nonDupButtonFactory: (id: string, showing?: boolean) => TagElementProps,
) {
  const mergeButtonID = innerButton ? BULK_MERGE_INNER_BUTTON_ID : BULK_MERGE_EXTERNAL_BUTTON_ID;
  const nonDuplicateButtonID = innerButton ? NON_DUPLICATE_INNER_BUTTON_ID : NON_DUPLICATE_EXTERNAL_BUTTON_ID;
  ztoolkit.UI.insertElementBefore(
    {
      tag: "div",
      namespace: "html",
      classList: ["duplicate-custom-head"],
      children: [
        bulkButtonFactory(siblingElement.ownerDocument.defaultView!, mergeButtonID),
        nonDupButtonFactory(nonDuplicateButtonID),
      ],
    },
    siblingElement,
  );
}

export async function registerButtonsInDuplicatePane(
  win: Window,
  bulkButtonFactory: (win: Window, id: string) => TagElementProps,
  nonDupButtonFactory: (id: string, showing?: boolean) => TagElementProps,
): Promise<void> {
  // 1. when selecting items in duplicatePane
  const mergeButton = win.document.getElementById("zotero-duplicates-merge-button");
  if (mergeButton) {
    const groupBox = mergeButton.parentElement as Element;
    addButtonsInDuplicatePanes(true, groupBox, bulkButtonFactory, nonDupButtonFactory);
  }
  // 2. when not selecting items, i.e., in itemMessagePane
  const customHead = win.document.querySelector("item-message-pane .custom-head");
  if (customHead) {
    addButtonsInDuplicatePanes(false, customHead, bulkButtonFactory, nonDupButtonFactory);
  }

  await updateDuplicateButtonsVisibilities(win);
}

export async function updateDuplicateButtonsVisibilities(win: Window): Promise<void> {
  const inDuplicatePane = isInDuplicatesPane();
  const showBulkMergeButton = inDuplicatePane && (activeItemsView()?.rowCount ?? 0) > 0;
  const showNonDuplicateButton = inDuplicatePane && (await areDuplicates());
  toggleButtonHidden(win, !showBulkMergeButton, BULK_MERGE_INNER_BUTTON_ID, BULK_MERGE_EXTERNAL_BUTTON_ID);
  toggleButtonHidden(win, !showNonDuplicateButton, NON_DUPLICATE_INNER_BUTTON_ID, NON_DUPLICATE_EXTERNAL_BUTTON_ID);
}
