import type { Disposer } from "../../app/lifecycle";
import { BulkMergeController, bulkMergeController } from "./bulkMergeService";

export { BulkMergeController, bulkMergeController } from "./bulkMergeService";

export async function registerBulkMergeWindow(
  win: Window,
  controller: BulkMergeController,
  updateVisibilities: (win: Window) => Promise<void>,
): Promise<Disposer> {
  return controller.registerUIElements(win, updateVisibilities);
}
