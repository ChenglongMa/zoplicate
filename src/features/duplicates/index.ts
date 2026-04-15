import type { TagElementProps } from "zotero-plugin-toolkit";
import { DisposerRegistry, type Disposer } from "../../app/lifecycle";
import type { NonDuplicatesDB } from "../../db/nonDuplicates";
import {
  patchFindDuplicates,
  patchGetSearchObject,
  patchItemSaveData,
} from "../../integrations/zotero/patches";
import { Duplicates } from "./duplicates";

export { Duplicates } from "./duplicates";
export { registerButtonsInDuplicatePane, updateDuplicateButtonsVisibilities } from "./duplicatePaneUI";
export { createDuplicatesNotifyHandler } from "./notifyHandlers";

export async function registerDuplicatesGlobal(options: {
  nonDuplicatesDB: NonDuplicatesDB;
  getLoadedWindows: () => Window[];
  getNonDuplicatesState: () => { allNonDuplicates: Set<string> };
  refreshDuplicateStats: (
    libraryID: number,
    duplicatesObj: { getSetItemsByItemID(itemID: number): number[] },
    duplicateItems: number[],
  ) => Promise<void>;
}): Promise<Disposer> {
  const registry = new DisposerRegistry();
  Duplicates.instance.setLoadedWindowsProvider(options.getLoadedWindows);
  registry.add(() => Duplicates.instance.clearWindowReferences());
  registry.add(patchFindDuplicates(options.nonDuplicatesDB, options.getNonDuplicatesState));
  registry.add(patchGetSearchObject(options.refreshDuplicateStats));
  registry.add(patchItemSaveData());
  return () => registry.disposeAll();
}

export async function registerDuplicatesWindow(
  win: Window,
  bulkButtonFactory: (win: Window, id: string) => TagElementProps,
  nonDupButtonFactory: (win: Window, id: string, showing?: boolean) => TagElementProps,
): Promise<Disposer> {
  const { registerButtonsInDuplicatePane } = await import("./duplicatePaneUI");
  await registerButtonsInDuplicatePane(win, bulkButtonFactory, nonDupButtonFactory);
  return () => {};
}
