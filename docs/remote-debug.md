# Remote Zotero UI Debugging

This project uses `zotero-plugin-scaffold` for build/serve and `zotero-plugin-toolkit` in the plugin runtime. On a remote Ubuntu server without a physical desktop, run Zotero inside a virtual X display and connect to it over an SSH-tunneled VNC session.

## One-Time Setup

Install Ubuntu GUI/debug dependencies:

```bash
npm run zotero:deps
```

If you do not have sudo, install these packages by another route:

```bash
sudo apt-get update
sudo apt-get install -y xvfb x11vnc fluxbox dbus-x11 xdotool scrot x11-utils xz-utils curl bzip2 tar
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

Start the virtual display, VNC server, and `zotero-plugin-scaffold` serve mode:

```bash
npm run zotero:debug
```

The helper keeps scaffold behavior intact:

- `npm run start` still runs `zotero-plugin serve`.
- Scaffold still installs/reloads the plugin in Zotero.
- `server.devtools` still enables the browser toolbox/debugger path.
- `server.startArgs` adds `-ZoteroDebugText`.
- A generated wrapper captures Zotero stdout/stderr to `logs/zotero-remote/latest-zotero-debug.log`, because scaffold does not forward Zotero child-process output.

From your local machine, tunnel the VNC port:

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

Use an existing Zotero installation:

```bash
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/opt/zotero/zotero npm run zotero:debug
```

Disable VNC when you only need log capture:

```bash
ZOTERO_REMOTE_VNC=0 npm run zotero:debug
```

Overwrite `.env` with the helper's detected paths:

```bash
FORCE_ENV=1 npm run zotero:install
```

## Notes

Use a dedicated development profile and data directory. The helper defaults to `.scaffold/remote-debug/profile` and `.scaffold/remote-debug/data` when `.env` does not provide paths.

The official Zotero Linux package is a GUI application. The reliable remote-server setup is virtual display plus VNC, not a true headless Zotero process.
