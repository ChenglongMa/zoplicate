#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ZOTERO_REMOTE_STATE_DIR:-$ROOT_DIR/.scaffold/remote-debug}"
LOG_DIR="${ZOTERO_REMOTE_LOG_DIR:-$ROOT_DIR/logs/zotero-remote}"
BIN_DIR="$STATE_DIR/bin"
WRAPPER_PATH="$BIN_DIR/zotero-debug-wrapper"
DISPLAY_NAME="${ZOTERO_REMOTE_DISPLAY:-:99}"
DISPLAY_ID="${DISPLAY_NAME#:}"
RESOLUTION="${ZOTERO_REMOTE_RESOLUTION:-1920x1080x24}"
VNC_PORT="${ZOTERO_REMOTE_VNC_PORT:-5901}"
ENABLE_VNC="${ZOTERO_REMOTE_VNC:-1}"
VNC_LOCALHOST="${ZOTERO_REMOTE_VNC_LOCALHOST:-1}"
WM_COMMAND="${ZOTERO_REMOTE_WM:-auto}"
INSTALL_DIR="${ZOTERO_REMOTE_INSTALL_DIR:-$ROOT_DIR/.scaffold/zotero}"
DOWNLOAD_URL="${ZOTERO_DOWNLOAD_URL:-https://www.zotero.org/download/client/dl?channel=release&platform=linux-x86_64}"

APT_PACKAGES=(
  xvfb
  x11vnc
  fluxbox
  dbus-x11
  xdotool
  scrot
  x11-utils
  xz-utils
  curl
  bzip2
  tar
)

usage() {
  cat <<'USAGE'
Usage:
  scripts/zotero-remote-debug.sh <command>

Commands:
  doctor          Check local prerequisites and resolved Zotero paths.
  install-deps    Install Ubuntu packages with apt/sudo.
  install-zotero  Download the official Zotero Linux tarball into .scaffold/zotero.
  write-env       Write a .env file for zotero-plugin-scaffold. Existing .env is not overwritten unless FORCE_ENV=1.
  start           Start Xvfb, optional VNC, and `npm run start` with Zotero logs captured.
  stop            Stop processes started by this helper.
  logs            Tail the latest scaffold and Zotero debug logs.
  screenshot      Capture the virtual display into logs/zotero-remote.

Useful environment variables:
  ZOTERO_PLUGIN_ZOTERO_BIN_PATH  Real Zotero binary for normal scaffold use.
  ZOTERO_REAL_BIN_PATH           Override real Zotero binary when start uses a wrapper.
  ZOTERO_PLUGIN_PROFILE_PATH     Development profile path.
  ZOTERO_PLUGIN_DATA_DIR         Development data directory.
  ZOTERO_REMOTE_DISPLAY          X display, default :99.
  ZOTERO_REMOTE_RESOLUTION       Xvfb screen, default 1920x1080x24.
  ZOTERO_REMOTE_VNC_PORT         Localhost VNC port, default 5901.
  ZOTERO_REMOTE_VNC              Set to 0 to disable x11vnc.
  ZOTERO_REMOTE_INSTALL_DIR      Zotero tarball install dir, default .scaffold/zotero.
USAGE
}

log() {
  printf '[zotero-remote] %s\n' "$*"
}

warn() {
  printf '[zotero-remote] WARN: %s\n' "$*" >&2
}

die() {
  printf '[zotero-remote] ERROR: %s\n' "$*" >&2
  exit 1
}

trim() {
  local value="$*"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

expand_path() {
  local value="$1"
  case "$value" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${value#~/}" ;;
    *) printf '%s' "$value" ;;
  esac
}

absolute_path() {
  local value
  value="$(expand_path "$1")"
  if [[ "$value" = /* ]]; then
    printf '%s' "$value"
  else
    printf '%s/%s' "$ROOT_DIR" "$value"
  fi
}

load_dotenv() {
  local env_file="$ROOT_DIR/.env"
  [[ -f "$env_file" ]] || return 0

  local raw key value
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    raw="${raw%$'\r'}"
    [[ "$raw" =~ ^[[:space:]]*$ ]] && continue
    [[ "$raw" =~ ^[[:space:]]*# ]] && continue
    [[ "$raw" == *"="* ]] || continue

    key="$(trim "${raw%%=*}")"
    value="$(trim "${raw#*=}")"

    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done <"$env_file"
}

ensure_state_dirs() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" "$BIN_DIR"
}

resolve_real_zotero_bin() {
  local candidate=""
  if [[ -n "${ZOTERO_REAL_BIN_PATH:-}" ]]; then
    candidate="$ZOTERO_REAL_BIN_PATH"
  elif [[ -n "${ZOTERO_PLUGIN_ZOTERO_BIN_PATH:-}" && "$(absolute_path "$ZOTERO_PLUGIN_ZOTERO_BIN_PATH")" != "$WRAPPER_PATH" ]]; then
    candidate="$ZOTERO_PLUGIN_ZOTERO_BIN_PATH"
  elif [[ -x "$INSTALL_DIR/zotero" ]]; then
    candidate="$INSTALL_DIR/zotero"
  elif command -v zotero >/dev/null 2>&1; then
    candidate="$(command -v zotero)"
  fi

  [[ -n "$candidate" ]] || return 1
  candidate="$(absolute_path "$candidate")"
  [[ -x "$candidate" ]] || return 1
  printf '%s' "$candidate"
}

default_profile_path() {
  printf '%s' "${ZOTERO_PLUGIN_PROFILE_PATH:-$STATE_DIR/profile}"
}

default_data_dir() {
  printf '%s' "${ZOTERO_PLUGIN_DATA_DIR:-$STATE_DIR/data}"
}

write_env() {
  ensure_state_dirs
  load_dotenv

  local zotero_bin="${1:-}"
  if [[ -z "$zotero_bin" ]]; then
    zotero_bin="$(resolve_real_zotero_bin || true)"
  fi
  [[ -n "$zotero_bin" ]] || die "No Zotero binary found. Run install-zotero or set ZOTERO_PLUGIN_ZOTERO_BIN_PATH."

  local env_file="$ROOT_DIR/.env"
  if [[ -f "$env_file" && "${FORCE_ENV:-0}" != "1" ]]; then
    warn ".env already exists; leaving it unchanged. Re-run with FORCE_ENV=1 to overwrite."
    log "Expected scaffold values:"
    printf '  ZOTERO_PLUGIN_ZOTERO_BIN_PATH=%s\n' "$zotero_bin"
    printf '  ZOTERO_PLUGIN_PROFILE_PATH=%s\n' "$(default_profile_path)"
    printf '  ZOTERO_PLUGIN_DATA_DIR=%s\n' "$(default_data_dir)"
    return 0
  fi

  mkdir -p "$(default_profile_path)" "$(default_data_dir)"
  cat >"$env_file" <<EOF
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=$zotero_bin
ZOTERO_PLUGIN_PROFILE_PATH=$(default_profile_path)
ZOTERO_PLUGIN_DATA_DIR=$(default_data_dir)
EOF
  log "Wrote $env_file"
}

create_zotero_wrapper() {
  local real_bin="$1"
  local zotero_log="$2"
  local pid_file="$3"

  ensure_state_dirs
  cat >"$WRAPPER_PATH" <<'WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail

real_bin="${ZOTERO_REAL_BIN_PATH:?ZOTERO_REAL_BIN_PATH is required}"
log_file="${ZOTERO_REMOTE_ZOTERO_LOG:?ZOTERO_REMOTE_ZOTERO_LOG is required}"
pid_file="${ZOTERO_REMOTE_ZOTERO_PID_FILE:-}"

mkdir -p "$(dirname "$log_file")"
if [[ -n "$pid_file" ]]; then
  mkdir -p "$(dirname "$pid_file")"
  printf '%s\n' "$$" >"$pid_file"
fi

{
  printf '[%s] exec:' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf ' %q' "$real_bin" "$@"
  printf '\n'
} >>"$log_file"

exec "$real_bin" "$@" >>"$log_file" 2>&1
WRAPPER
  chmod +x "$WRAPPER_PATH"

  export ZOTERO_REAL_BIN_PATH="$real_bin"
  export ZOTERO_REMOTE_ZOTERO_LOG="$zotero_log"
  export ZOTERO_REMOTE_ZOTERO_PID_FILE="$pid_file"
  export ZOTERO_PLUGIN_ZOTERO_BIN_PATH="$WRAPPER_PATH"
  export ZOTERO_PLUGIN_KILL_COMMAND="if test -f \"$pid_file\"; then kill -9 \$(cat \"$pid_file\") 2>/dev/null || true; fi"
}

pid_is_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

kill_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

display_is_up() {
  if command -v xdpyinfo >/dev/null 2>&1; then
    DISPLAY="$DISPLAY_NAME" xdpyinfo >/dev/null 2>&1
  else
    [[ -S "/tmp/.X11-unix/X$DISPLAY_ID" ]]
  fi
}

start_xvfb() {
  local pid_file="$STATE_DIR/xvfb.pid"
  if display_is_up; then
    log "Reusing existing display $DISPLAY_NAME"
    return 0
  fi
  command -v Xvfb >/dev/null 2>&1 || die "Xvfb not found. Run install-deps or install package xvfb."
  log "Starting Xvfb on $DISPLAY_NAME ($RESOLUTION)"
  Xvfb "$DISPLAY_NAME" -screen 0 "$RESOLUTION" -nolisten tcp >"$LOG_DIR/xvfb.log" 2>&1 &
  printf '%s\n' "$!" >"$pid_file"
  sleep 1
  display_is_up || die "Xvfb did not start. See $LOG_DIR/xvfb.log"
}

choose_window_manager() {
  if [[ "$WM_COMMAND" != "auto" ]]; then
    printf '%s' "$WM_COMMAND"
    return 0
  fi
  if command -v fluxbox >/dev/null 2>&1; then
    printf 'fluxbox'
  elif command -v openbox >/dev/null 2>&1; then
    printf 'openbox'
  elif command -v metacity >/dev/null 2>&1; then
    printf 'metacity'
  else
    return 1
  fi
}

start_window_manager() {
  local pid_file="$STATE_DIR/wm.pid"
  pid_is_alive "$pid_file" && return 0

  local wm
  wm="$(choose_window_manager || true)"
  if [[ -z "$wm" ]]; then
    warn "No window manager found. Zotero can start, but dialogs may be awkward. Install fluxbox/openbox."
    return 0
  fi

  log "Starting window manager: $wm"
  DISPLAY="$DISPLAY_NAME" "$wm" >"$LOG_DIR/window-manager.log" 2>&1 &
  printf '%s\n' "$!" >"$pid_file"
}

start_vnc() {
  [[ "$ENABLE_VNC" == "1" ]] || return 0
  command -v x11vnc >/dev/null 2>&1 || {
    warn "x11vnc not found; VNC disabled. Run install-deps or install package x11vnc."
    return 0
  }

  local pid_file="$STATE_DIR/x11vnc.pid"
  pid_is_alive "$pid_file" && return 0

  local listen_args=()
  if [[ "$VNC_LOCALHOST" == "1" ]]; then
    listen_args=(-localhost)
  fi

  log "Starting x11vnc on port $VNC_PORT"
  DISPLAY="$DISPLAY_NAME" x11vnc \
    -display "$DISPLAY_NAME" \
    "${listen_args[@]}" \
    -forever \
    -shared \
    -nopw \
    -rfbport "$VNC_PORT" \
    >"$LOG_DIR/x11vnc.log" 2>&1 &
  printf '%s\n' "$!" >"$pid_file"
}

print_connection_info() {
  log "Virtual display: $DISPLAY_NAME"
  if [[ "$ENABLE_VNC" == "1" ]]; then
    log "VNC is bound to localhost:$VNC_PORT"
    log "From your local machine, tunnel with:"
    printf '  ssh -L %s:localhost:%s <user>@<server>\n' "$VNC_PORT" "$VNC_PORT"
    log "Then open your VNC viewer at localhost:$VNC_PORT"
  fi
}

install_deps() {
  command -v apt-get >/dev/null 2>&1 || die "install-deps only supports Debian/Ubuntu apt."
  command -v sudo >/dev/null 2>&1 || die "sudo not found; install manually: apt-get install ${APT_PACKAGES[*]}"
  sudo apt-get update
  sudo apt-get install -y "${APT_PACKAGES[@]}"
}

install_zotero() {
  ensure_state_dirs
  mkdir -p "$STATE_DIR/downloads"

  if [[ -x "$INSTALL_DIR/zotero" && "${FORCE_ZOTERO_INSTALL:-0}" != "1" ]]; then
    log "Zotero already installed at $INSTALL_DIR/zotero"
    write_env "$INSTALL_DIR/zotero"
    return 0
  fi

  command -v tar >/dev/null 2>&1 || die "tar not found."
  command -v xz >/dev/null 2>&1 || warn "xz not found. Current Zotero Linux archives normally need xz-utils."

  local archive="$STATE_DIR/downloads/zotero-linux.tar"
  log "Downloading Zotero from $DOWNLOAD_URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fL "$DOWNLOAD_URL" -o "$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$archive" "$DOWNLOAD_URL"
  else
    die "curl or wget is required to download Zotero."
  fi

  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -taf "$archive" >/dev/null
  tar -xaf "$archive" -C "$INSTALL_DIR" --strip-components=1
  [[ -x "$INSTALL_DIR/zotero" ]] || die "Downloaded archive did not contain an executable zotero binary."
  log "Installed Zotero at $INSTALL_DIR/zotero"
  write_env "$INSTALL_DIR/zotero"
}

doctor() {
  load_dotenv
  ensure_state_dirs

  log "Project: $ROOT_DIR"
  log "State:   $STATE_DIR"
  log "Logs:    $LOG_DIR"
  printf '\n'

  local missing=()
  local cmd
  for cmd in node npm Xvfb x11vnc fluxbox dbus-run-session xdotool scrot xdpyinfo curl tar xz bzip2; do
    if command -v "$cmd" >/dev/null 2>&1; then
      printf 'ok      %s -> %s\n' "$cmd" "$(command -v "$cmd")"
    else
      printf 'missing %s\n' "$cmd"
      missing+=("$cmd")
    fi
  done
  printf '\n'

  if [[ -d "$ROOT_DIR/node_modules/zotero-plugin-scaffold" ]]; then
    printf 'ok      node_modules/zotero-plugin-scaffold\n'
  else
    printf 'missing node_modules/zotero-plugin-scaffold; run npm install\n'
  fi

  local real_bin
  real_bin="$(resolve_real_zotero_bin || true)"
  if [[ -n "$real_bin" ]]; then
    printf 'ok      Zotero binary -> %s\n' "$real_bin"
  else
    printf 'missing Zotero binary; run scripts/zotero-remote-debug.sh install-zotero or set ZOTERO_PLUGIN_ZOTERO_BIN_PATH\n'
  fi

  printf 'info    profile -> %s\n' "$(default_profile_path)"
  printf 'info    dataDir -> %s\n' "$(default_data_dir)"
  printf 'info    display -> %s (%s)\n' "$DISPLAY_NAME" "$RESOLUTION"
  printf 'info    vnc     -> localhost:%s\n' "$VNC_PORT"

  if ((${#missing[@]} > 0)); then
    printf '\nInstall Ubuntu GUI/debug dependencies with:\n'
    printf '  sudo apt-get update && sudo apt-get install -y'
    printf ' %s' "${APT_PACKAGES[@]}"
    printf '\n'
  fi
}

start() {
  cd "$ROOT_DIR"
  load_dotenv
  ensure_state_dirs

  local real_bin
  real_bin="$(resolve_real_zotero_bin || true)"
  [[ -n "$real_bin" ]] || die "No Zotero binary found. Run install-zotero or set ZOTERO_PLUGIN_ZOTERO_BIN_PATH."

  export ZOTERO_PLUGIN_PROFILE_PATH
  export ZOTERO_PLUGIN_DATA_DIR
  ZOTERO_PLUGIN_PROFILE_PATH="$(absolute_path "$(default_profile_path)")"
  ZOTERO_PLUGIN_DATA_DIR="$(absolute_path "$(default_data_dir)")"
  mkdir -p "$ZOTERO_PLUGIN_PROFILE_PATH" "$ZOTERO_PLUGIN_DATA_DIR"

  local run_id zotero_log scaffold_log zotero_pid
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  zotero_log="$LOG_DIR/zotero-debug-$run_id.log"
  scaffold_log="$LOG_DIR/scaffold-serve-$run_id.log"
  zotero_pid="$STATE_DIR/zotero.pid"

  ln -sfn "$zotero_log" "$LOG_DIR/latest-zotero-debug.log"
  ln -sfn "$scaffold_log" "$LOG_DIR/latest-scaffold-serve.log"

  create_zotero_wrapper "$real_bin" "$zotero_log" "$zotero_pid"
  start_xvfb
  export DISPLAY="$DISPLAY_NAME"
  start_window_manager
  start_vnc
  print_connection_info

  log "Real Zotero binary: $real_bin"
  log "Scaffold binary wrapper: $WRAPPER_PATH"
  log "Zotero debug log: $zotero_log"
  log "Scaffold log: $scaffold_log"
  log "Starting zotero-plugin-scaffold via npm run start"

  printf '%s\n' "$$" >"$STATE_DIR/helper.pid"
  trap stop EXIT INT TERM

  if command -v dbus-run-session >/dev/null 2>&1; then
    dbus-run-session -- npm run start 2>&1 | tee "$scaffold_log"
  else
    npm run start 2>&1 | tee "$scaffold_log"
  fi
}

stop() {
  kill_pid_file "$STATE_DIR/zotero.pid"
  kill_pid_file "$STATE_DIR/x11vnc.pid"
  kill_pid_file "$STATE_DIR/wm.pid"
  kill_pid_file "$STATE_DIR/xvfb.pid"
  rm -f "$STATE_DIR/helper.pid"
}

logs() {
  ensure_state_dirs
  local files=()
  [[ -e "$LOG_DIR/latest-scaffold-serve.log" ]] && files+=("$LOG_DIR/latest-scaffold-serve.log")
  [[ -e "$LOG_DIR/latest-zotero-debug.log" ]] && files+=("$LOG_DIR/latest-zotero-debug.log")
  ((${#files[@]} > 0)) || die "No latest logs found in $LOG_DIR"
  tail -f "${files[@]}"
}

screenshot() {
  ensure_state_dirs
  command -v scrot >/dev/null 2>&1 || die "scrot not found. Run install-deps or install package scrot."
  local target="$LOG_DIR/screenshot-$(date -u +%Y%m%dT%H%M%SZ).png"
  DISPLAY="$DISPLAY_NAME" scrot "$target"
  log "Wrote $target"
}

main() {
  local command="${1:-}"
  case "$command" in
    doctor) doctor ;;
    install-deps) install_deps ;;
    install-zotero) install_zotero ;;
    write-env) write_env ;;
    start) start ;;
    stop) stop ;;
    logs) logs ;;
    screenshot) screenshot ;;
    -h|--help|help|"") usage ;;
    *) usage; die "Unknown command: $command" ;;
  esac
}

main "$@"
