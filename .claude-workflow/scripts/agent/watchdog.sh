#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AGENT_STATE_DIR="${ZOPLICATE_AGENT_STATE_DIR:-$PROJECT_DIR/.claude-workflow/state}"
STATE_FILE="$AGENT_STATE_DIR/runtime/working.json"
CHECKPOINT_DIR="$AGENT_STATE_DIR/runtime/checkpoints"
MEMORY_DIR="$AGENT_STATE_DIR/memory"
STALE_MINUTES="${1:-30}"
POLL_SECONDS="${2:-60}"
STALE_SECONDS=$((STALE_MINUTES * 60))
TARGET_PID="${CLAUDE_PARENT_PID:-}"
TARGET_TMUX_SESSION="${CLAUDE_TMUX_SESSION:-}"
SESSION_ID="${CLAUDE_SESSION_ID:-}"
WATCHDOG_LOG=""

session_id() {
  if [ -n "$SESSION_ID" ]; then
    printf '%s' "$SESSION_ID"
    return
  fi
  if [ ! -f "$STATE_FILE" ]; then
    return
  fi
  uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('session_id', ''))
except Exception:
    print('')
" "$STATE_FILE" 2>/dev/null
}

log_msg() {
  local msg="[watchdog] $*"
  echo "$msg"
  if [ -n "$WATCHDOG_LOG" ]; then
    mkdir -p "$(dirname "$WATCHDOG_LOG")"
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >> "$WATCHDOG_LOG"
  fi
}

log_msg "Monitoring: $STATE_FILE"
log_msg "Stale threshold: ${STALE_MINUTES}m | Poll interval: ${POLL_SECONDS}s"

while true; do
  sleep "$POLL_SECONDS"

  if [ ! -f "$STATE_FILE" ]; then
    continue
  fi

  if [ -z "$WATCHDOG_LOG" ]; then
    SESSION_ID="$(session_id)"
    if [ -n "$SESSION_ID" ]; then
      WATCHDOG_LOG="$AGENT_STATE_DIR/logs/$SESSION_ID/watchdog.log"
    fi
  fi

  if [ -n "$SESSION_ID" ]; then
    FILE_SESSION=$(uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('session_id', ''))
except Exception:
    print('')
" "$STATE_FILE" 2>/dev/null)
    if [ -n "$FILE_SESSION" ] && [ "$FILE_SESSION" != "$SESSION_ID" ]; then
      log_msg "session mismatch: expected=$SESSION_ID found=$FILE_SESSION; skipping"
      continue
    fi
  fi

  UPDATED_AGE=$(uv run python -c "
import json, sys
from datetime import datetime, timezone
try:
    d = json.load(open(sys.argv[1]))
    ts = d.get('updated_at', '')
    if not ts:
        print('0')
        sys.exit(0)
    dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - dt).total_seconds()
    print(int(age))
except Exception:
    print('0')
" "$STATE_FILE" 2>/dev/null)

  if ! [[ "$UPDATED_AGE" =~ ^[0-9]+$ ]]; then
    continue
  fi

  if [ "$UPDATED_AGE" -gt "$STALE_SECONDS" ]; then
    CURRENT_PHASE=$(uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('current_phase', 'unknown'))
except Exception:
    print('unknown')
" "$STATE_FILE" 2>/dev/null || echo "unknown")

    MILESTONE_ID=$(uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('milestone_id', '?'))
except Exception:
    print('?')
" "$STATE_FILE" 2>/dev/null || echo "?")

    log_msg "STALE DETECTED"
    log_msg "Milestone: $MILESTONE_ID | Phase: $CURRENT_PHASE"
    log_msg "State has not been updated for ${STALE_MINUTES}+ minutes"

    mkdir -p "$MEMORY_DIR" "$CHECKPOINT_DIR"
    EPISODES_FILE="$MEMORY_DIR/episodes.jsonl"
    EPISODE="{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"milestone_id\":\"$MILESTONE_ID\",\"episode_type\":\"failure\",\"phase\":\"$CURRENT_PHASE\",\"summary\":\"Watchdog timeout: agent stuck in phase $CURRENT_PHASE for ${STALE_MINUTES}+ minutes without state update\",\"details\":{\"stale_seconds\":$UPDATED_AGE},\"resolution\":\"Force-interrupted by watchdog\",\"tags\":[\"watchdog\",\"timeout\",\"stuck\"]}"
    echo "$EPISODE" >> "$EPISODES_FILE"
    log_msg "Episode recorded to $EPISODES_FILE"

    cp "$STATE_FILE" "$CHECKPOINT_DIR/$(date -u +%Y%m%dT%H%M%S)_watchdog_interrupt.json" 2>/dev/null || true
    log_msg "Checkpoint written"

    if [ -n "$TARGET_PID" ] && kill -0 "$TARGET_PID" 2>/dev/null; then
      log_msg "Sending SIGINT to Claude PID $TARGET_PID"
      kill -INT "$TARGET_PID" 2>/dev/null || true
      sleep 5
      if kill -0 "$TARGET_PID" 2>/dev/null; then
        log_msg "Escalating to SIGTERM for Claude PID $TARGET_PID"
        kill -TERM "$TARGET_PID" 2>/dev/null || true
      fi
    elif [ -n "$TARGET_TMUX_SESSION" ] && tmux has-session -t "$TARGET_TMUX_SESSION" 2>/dev/null; then
      log_msg "Sending Ctrl-C to tmux session '$TARGET_TMUX_SESSION'"
      tmux send-keys -t "$TARGET_TMUX_SESSION" C-c 2>/dev/null || true
    else
      log_msg "No explicit Claude target configured; watchdog recorded the failure but did not interrupt any process."
    fi

    log_msg "Resume with: /milestone-loop resume=latest"
    exit 0
  fi
done
