import { DisposerRegistry, type Disposer } from "../../app/lifecycle";
import { registerMenuDisposer } from "../../integrations/zotero/menuManager";
import { collectionMenuConfig } from "./duplicateStatsMenu";
import {
  getDuplicateStats,
  refreshDuplicateStats,
  registerDuplicateStats,
} from "./duplicateStats";

export {
  collectionMenuConfig,
  getDuplicateStats,
  refreshDuplicateStats,
  registerDuplicateStats,
};

export async function registerDuplicateStatsGlobal(): Promise<Disposer> {
  const registry = new DisposerRegistry();
  registry.add(registerMenuDisposer([collectionMenuConfig()]));
  return () => registry.disposeAll();
}

export async function registerDuplicateStatsWindow(win: Window): Promise<Disposer> {
  return registerDuplicateStats(win);
}
