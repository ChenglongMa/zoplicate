import { config } from "../../package.json";

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function registerStyleSheets() {
  const hrefs = ["zoplicate", "itemSection"];

  for (const href of hrefs) {
    const styles = ztoolkit.UI.createElement(document, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/${href}.css`,
      },
    })
    document.documentElement.appendChild(styles);
  }
}

export { isWindowAlive, registerStyleSheets };
