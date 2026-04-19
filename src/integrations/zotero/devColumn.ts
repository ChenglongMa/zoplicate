import { config } from "../../../package.json";
import type { Disposer } from "../../app/lifecycle";

export async function registerDevelopmentItemIDColumn(
  env: "development" | "production",
  enabled = false,
): Promise<Disposer> {
  if (env !== "development" || !enabled) {
    return () => {};
  }

  const field = "Item ID";
  const registeredDataKey = await Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: field,
    label: field,
    dataProvider: (item: Zotero.Item) => {
      return String(item.id) + " " + item.key;
    },
  });

  if (!registeredDataKey) {
    return () => {};
  }

  return async () => {
    await Zotero.ItemTreeManager.unregisterColumn(registeredDataKey);
  };
}
