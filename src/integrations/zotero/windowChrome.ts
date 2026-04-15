import { config } from "../../../package.json";
import { isWindowAlive } from "./windows";

function registerStyleSheets(win: Window) {
  const hrefs = ["zoplicate", "itemSection"];

  if (!isWindowAlive(win)) {
    ztoolkit.log("registerStyleSheets skipped because the target window is unavailable.");
    return;
  }
  for (const href of hrefs) {
    const styles = ztoolkit.UI.createElement(win.document, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/${href}.css`,
      },
    });
    win.document.documentElement.appendChild(styles);
  }
}

function bringToFront(win?: Window) {
  if (!isWindowAlive(win)) {
    return;
  }
  win.focus?.();
  win.document?.documentElement?.scrollIntoView?.();
}

export { registerStyleSheets, bringToFront };
