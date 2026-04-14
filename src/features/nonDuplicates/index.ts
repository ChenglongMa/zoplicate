import { DisposerRegistry, type Disposer } from "../../app/lifecycle";
import { NonDuplicatesDB } from "../../db/nonDuplicates";
import { registerMenuDisposer } from "../../integrations/zotero/menuManager";
import { createNonDuplicatesNotifyHandler, whenItemsDeleted } from "./notifyHandlers";
import { itemMenuConfig } from "./nonDuplicateMenu";
import { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./nonDuplicateSection";

export { createNonDuplicateButton, NonDuplicates, toggleNonDuplicates } from "./nonDuplicateActions";
export { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./nonDuplicateSection";
export { createNonDuplicatesNotifyHandler, whenItemsDeleted } from "./notifyHandlers";
export { itemMenuConfig } from "./nonDuplicateMenu";

export async function registerNonDuplicatesGlobal(): Promise<Disposer> {
  const registry = new DisposerRegistry();
  const nonDuplicatesDB = NonDuplicatesDB.instance;
  await nonDuplicatesDB.init();

  registerNonDuplicatesSection(nonDuplicatesDB);
  registry.add(() => unregisterNonDuplicatesSection());
  registry.add(registerMenuDisposer([itemMenuConfig()]));

  return () => registry.disposeAll();
}

export async function registerNonDuplicatesWindow(_win: Window): Promise<Disposer> {
  return () => {};
}
