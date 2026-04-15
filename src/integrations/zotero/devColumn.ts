import { config } from "../../../package.json";
import type { Disposer } from "../../app/lifecycle";

export async function registerDevelopmentItemIDColumn(
  env: "development" | "production",
): Promise<Disposer> {
  if (env !== "development") {
    return () => {};
  }

  const field = "Item ID";
  await Zotero.ItemTreeManager.registerColumns({
    pluginID: config.addonID,
    dataKey: field,
    label: field,
    dataProvider: (item: Zotero.Item) => {
      return String(item.id) + " " + item.key;
    },
  });

  return () => {};
}
