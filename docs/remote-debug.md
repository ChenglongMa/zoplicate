# Remote Zotero UI Debugging

This project uses `zotero-plugin-scaffold` for build/serve and `zotero-plugin-toolkit` in the plugin runtime. On a remote Ubuntu server without a physical desktop, run Zotero inside a virtual X display and connect to it with noVNC in a browser or with a native VNC viewer.

## One-Time Setup

Install Ubuntu GUI/debug dependencies:

```bash
npm run zotero:deps
```

If you do not have sudo, install these packages by another route:

```bash
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify fluxbox dbus-x11 xdotool scrot x11-utils xz-utils curl bzip2 tar
```

Download the official Zotero Linux tarball into `.scaffold/zotero` and create `.env` if one does not already exist:

```bash
npm run zotero:install
```

Check the resolved paths and missing tools:

```bash
npm run zotero:doctor
```

## Start A Debug Session

Start the virtual display, noVNC/VNC servers, and `zotero-plugin-scaffold` serve mode:

```bash
npm run zotero:debug
```

The helper keeps scaffold behavior intact:

- `npm run start` still runs `zotero-plugin serve`.
- Scaffold still installs/reloads the plugin in Zotero.
- `server.devtools` still enables the browser toolbox/debugger path.
- `server.startArgs` adds `-ZoteroDebugText`.
- A generated wrapper captures Zotero stdout/stderr to `logs/zotero-remote/latest-zotero-debug.log`, because scaffold does not forward Zotero child-process output.

### Browser/noVNC

When using VS Code Remote-SSH, open the Ports panel and forward port `6080`. Then open:

```text
http://localhost:6080/vnc.html?host=localhost&port=6080&path=websockify&autoconnect=1&resize=scale
```

From a local terminal, the equivalent SSH tunnel is:

```bash
ssh -L 6080:127.0.0.1:6080 <user>@<server>
```

Then open the same URL in your browser. This is the easiest option when you want the Zotero GUI inside a browser or VS Code Simple Browser.

### Native VNC Viewer

The helper also starts native VNC on port `5901`. From your local machine, tunnel the VNC port:

```bash
ssh -L 5901:localhost:5901 <user>@<server>
```

Open a VNC viewer at:

```text
localhost:5901
```

## Logs And Screenshots

Tail the current scaffold and Zotero logs:

```bash
npm run zotero:logs
```

Filter likely plugin/runtime errors:

```bash
rg -n "zoplicate|JavaScript error|TypeError|ReferenceError|Unhandled|Exception|ERROR" logs/zotero-remote
```

Capture the virtual display:

```bash
npm run zotero:screenshot
```

Stop helper-managed processes:

```bash
npm run zotero:stop
```

## Useful Overrides

All options can be passed as environment variables:

```bash
ZOTERO_REMOTE_DISPLAY=:100 ZOTERO_REMOTE_VNC_PORT=5902 npm run zotero:debug
```

Move the noVNC HTTP port:

```bash
ZOTERO_REMOTE_NOVNC_PORT=6081 npm run zotero:debug
```

Disable noVNC and keep only native VNC:

```bash
ZOTERO_REMOTE_NOVNC=0 npm run zotero:debug
```

Use an existing Zotero installation:

```bash
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/opt/zotero/zotero npm run zotero:debug
```

Disable all GUI remoting when you only need log capture:

```bash
ZOTERO_REMOTE_VNC=0 ZOTERO_REMOTE_NOVNC=0 npm run zotero:debug
```

Overwrite `.env` with the helper's detected paths:

```bash
FORCE_ENV=1 npm run zotero:install
```

## Notes

Use a dedicated development profile and data directory. The helper defaults to `.scaffold/remote-debug/profile` and `.scaffold/remote-debug/data` when `.env` does not provide paths.

The official Zotero Linux package is a GUI application. The reliable remote-server setup is virtual display plus VNC/noVNC, not a true headless Zotero process.
