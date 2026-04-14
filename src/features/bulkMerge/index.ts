import type { Disposer } from "../../app/lifecycle";
import { BulkMergeController, bulkMergeController } from "./bulkMergeService";

export { BulkMergeController, bulkMergeController } from "./bulkMergeService";

export function registerBulkMergeWindow(
  win: Window,
  controller: BulkMergeController,
  updateVisibilities: (win: Window) => Promise<void>,
): Disposer {
  return controller.registerUIElements(win, updateVisibilities);
}
