import { config } from "../../package.json";

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function registerStyleSheets(win?: Window) {
  const hrefs = ["zoplicate", "itemSection"];

  if (!win) {
    win = window;
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
  if (!win) {
    win = window;
  }
  win.focus();
  win.document.documentElement.scrollIntoView();
}

export { isWindowAlive, registerStyleSheets, bringToFront };
