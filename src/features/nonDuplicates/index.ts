import { DisposerRegistry, type Disposer } from "../../app/lifecycle";
import type { NonDuplicatesDB } from "../../db/nonDuplicates";
import { registerMenuDisposer } from "../../integrations/zotero/menuManager";
import { createNonDuplicatesNotifyHandler, whenItemsDeleted } from "./notifyHandlers";
import { itemMenuConfig } from "./nonDuplicateMenu";
import { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./nonDuplicateSection";

export { createNonDuplicateButton, NonDuplicates, toggleNonDuplicates } from "./nonDuplicateActions";
export { registerNonDuplicatesSection, unregisterNonDuplicatesSection } from "./nonDuplicateSection";
export { createNonDuplicatesNotifyHandler, whenItemsDeleted } from "./notifyHandlers";
export { itemMenuConfig } from "./nonDuplicateMenu";
export { refreshLocalFromSync } from "./syncRefresh";
export { registerSyncListener } from "./syncListener";
export { hydrateAllLibraries } from "./hydration";

export async function registerNonDuplicatesGlobal(nonDuplicatesDB: NonDuplicatesDB): Promise<Disposer> {
  const registry = new DisposerRegistry();

  registerNonDuplicatesSection(nonDuplicatesDB);
  registry.add(() => unregisterNonDuplicatesSection());
  registry.add(registerMenuDisposer([itemMenuConfig()]));

  return () => registry.disposeAll();
}

export async function registerNonDuplicatesWindow(_win: Window): Promise<Disposer> {
  return () => {};
}
