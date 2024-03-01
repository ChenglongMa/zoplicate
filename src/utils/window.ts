import { config } from "../../package.json";

export { isWindowAlive, registerStyleSheet };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function registerStyleSheet() {
  const styles = ztoolkit.UI.createElement(document, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${config.addonRef}/content/zoteroPane.css`,
    },
  });
  document.documentElement.appendChild(styles);
}
