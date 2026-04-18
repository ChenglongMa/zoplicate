#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/zotero-remote-debug.sh"

BETA_INSTALL_DIR="${ZOTERO_BETA_INSTALL_DIR:-$ROOT_DIR/.scaffold/zotero-beta}"
BETA_STATE_DIR="${ZOTERO_BETA_STATE_DIR:-$ROOT_DIR/.scaffold/remote-debug-beta}"
BETA_LOG_DIR="${ZOTERO_BETA_LOG_DIR:-$ROOT_DIR/logs/zotero-remote-beta}"
BETA_DISPLAY="${ZOTERO_BETA_DISPLAY:-:100}"
BETA_VNC_PORT="${ZOTERO_BETA_VNC_PORT:-5902}"
BETA_NOVNC_PORT="${ZOTERO_BETA_NOVNC_PORT:-6081}"
BETA_NOVNC_HOST="${ZOTERO_BETA_NOVNC_HOST:-127.0.0.1}"
BETA_DOWNLOAD_URL="${ZOTERO_BETA_DOWNLOAD_URL:-https://www.zotero.org/download/client/dl?channel=beta&platform=linux-x86_64}"
BETA_OPEN_DELAY="${ZOTERO_BETA_NOVNC_OPEN_DELAY:-8}"

NOVNC_URL="http://localhost:${BETA_NOVNC_PORT}/vnc.html?host=localhost&port=${BETA_NOVNC_PORT}&path=websockify&autoconnect=1&resize=scale"

usage() {
  cat <<USAGE
Usage:
  scripts/zotero-beta-debug.sh [command]

Commands:
  start        Start Zotero beta debug environment and auto-open noVNC. Default.
  install      Download the official Zotero beta into .scaffold/zotero-beta.
  open-novnc   Open the beta noVNC URL in a browser.
  stop         Stop beta debug helper processes.
  logs         Tail latest beta debug logs.
  screenshot   Capture beta virtual display screenshot.
  doctor       Check beta debug prerequisites and paths.

noVNC URL:
  $NOVNC_URL
USAGE
}

open_novnc() {
  printf '[zotero-beta] Opening noVNC: %s\n' "$NOVNC_URL"

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$NOVNC_URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$NOVNC_URL" >/dev/null 2>&1 &
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "$NOVNC_URL" >/dev/null 2>&1 &
  else
    printf '[zotero-beta] No browser opener found. Open this URL manually:\n  %s\n' "$NOVNC_URL"
  fi
}

run_helper() {
  ZOTERO_REMOTE_INSTALL_DIR="$BETA_INSTALL_DIR" \
  ZOTERO_REMOTE_STATE_DIR="$BETA_STATE_DIR" \
  ZOTERO_REMOTE_LOG_DIR="$BETA_LOG_DIR" \
  ZOTERO_PLUGIN_ZOTERO_BIN_PATH="$BETA_INSTALL_DIR/zotero" \
  ZOTERO_PLUGIN_PROFILE_PATH="$BETA_STATE_DIR/profile" \
  ZOTERO_PLUGIN_DATA_DIR="$BETA_STATE_DIR/data" \
  ZOTERO_REMOTE_DISPLAY="$BETA_DISPLAY" \
  ZOTERO_REMOTE_VNC_PORT="$BETA_VNC_PORT" \
  ZOTERO_REMOTE_NOVNC_PORT="$BETA_NOVNC_PORT" \
  ZOTERO_REMOTE_NOVNC_HOST="$BETA_NOVNC_HOST" \
  ZOTERO_DOWNLOAD_URL="$BETA_DOWNLOAD_URL" \
  bash "$HELPER" "$@"
}

command="${1:-start}"
case "$command" in
  start)
    if [[ "${ZOTERO_BETA_AUTO_OPEN_NOVNC:-1}" == "1" ]]; then
      (sleep "$BETA_OPEN_DELAY"; open_novnc) &
    fi
    run_helper start
    ;;
  install)
    run_helper install-zotero
    ;;
  open-novnc|vnc)
    open_novnc
    ;;
  stop|logs|screenshot|doctor)
    run_helper "$command"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    printf '[zotero-beta] Unknown command: %s\n' "$command" >&2
    exit 1
    ;;
esac
