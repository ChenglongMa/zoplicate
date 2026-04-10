#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AGENT_STATE_DIR="${ZOPLICATE_AGENT_STATE_DIR:-$PROJECT_DIR/.claude-workflow/state}"
SHARED_DIR="$AGENT_STATE_DIR/shared"
STATE_FILE="$AGENT_STATE_DIR/runtime/working.json"
TIMEOUT="${ZOPLICATE_TEST_TIMEOUT:-300}"
POLL_INTERVAL=10
TEST_ARGS="${*:-}"
TEST_COMMAND="${CLAUDE_TEST_COMMAND:-npm test -- --runInBand}"

SESSION_ID=$(uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('session_id', 'adhoc'))
except Exception:
    print('adhoc')
" "$STATE_FILE" 2>/dev/null)
SESSION_KEY=$(printf '%s' "$SESSION_ID" | tr -cd '[:alnum:]' | cut -c1-8)
[ -n "$SESSION_KEY" ] || SESSION_KEY="adhoc"
SESSION_NAME="zoplicate_test_${SESSION_KEY}"
LOG_DIR="$AGENT_STATE_DIR/logs/$SESSION_ID"
LOG_FILE="$LOG_DIR/test_output.log"
SUMMARY_FILE="$SHARED_DIR/test_summary.json"
ARTIFACTS_FILE="$SHARED_DIR/test_artifacts.json"
EXIT_CODE_FILE="$SHARED_DIR/test_exit_code"
PID_FILE="$SHARED_DIR/test_pid"

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

mkdir -p "$SHARED_DIR" "$LOG_DIR"
rm -f "$EXIT_CODE_FILE" "$PID_FILE" "$SUMMARY_FILE" "$ARTIFACTS_FILE" "$SHARED_DIR/test_log_path"
: > "$LOG_FILE"
printf '%s\n' "$LOG_FILE" > "$SHARED_DIR/test_log_path"

FORWARDED_ENV="export PATH='${PATH}'; export HOME='${HOME}';"
if [ -n "${VIRTUAL_ENV:-}" ]; then
  FORWARDED_ENV="${FORWARDED_ENV} export VIRTUAL_ENV='${VIRTUAL_ENV}';"
fi
if [ -n "${UV_CACHE_DIR:-}" ]; then
  FORWARDED_ENV="${FORWARDED_ENV} export UV_CACHE_DIR='${UV_CACHE_DIR}';"
fi
if [ -n "${ZOPLICATE_AGENT_STATE_DIR:-}" ]; then
  FORWARDED_ENV="${FORWARDED_ENV} export ZOPLICATE_AGENT_STATE_DIR='${ZOPLICATE_AGENT_STATE_DIR}';"
fi

tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR" "bash -lc '
  ${FORWARDED_ENV}
  echo \$\$ > \"${PID_FILE}\"
  COMMAND_LINE=\"${TEST_COMMAND}\"
  if [ -n \"${TEST_ARGS}\" ]; then
    COMMAND_LINE=\"${TEST_COMMAND} ${TEST_ARGS}\"
  fi
  eval \"${COMMAND_LINE}\" 2>&1 | tee \"${LOG_FILE}\"
  echo \${PIPESTATUS[0]} > \"${EXIT_CODE_FILE}\"
'"

echo "tmux session '${SESSION_NAME}' started. Observe: tmux attach -t ${SESSION_NAME}"

STARTUP_WAIT=0
while [ ! -f "$PID_FILE" ] && [ "$STARTUP_WAIT" -lt 5 ]; do
  sleep 0.5
  STARTUP_WAIT=$((STARTUP_WAIT + 1))
done

if [ ! -f "$PID_FILE" ]; then
  echo "WARNING: test_pid not created after 5s. tmux session may have failed to start."
fi

ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if [ -f "$EXIT_CODE_FILE" ]; then
    EXIT_CODE=$(cat "$EXIT_CODE_FILE")
    echo "Tests completed with exit code: $EXIT_CODE"
    break
  fi

  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    if [ ! -f "$EXIT_CODE_FILE" ]; then
      echo "SESSION CRASH: tmux session '${SESSION_NAME}' died without writing exit code."
      echo "137" > "$EXIT_CODE_FILE"
      echo "SESSION CRASH: tmux session died at ${ELAPSED}s (likely OOM or SIGKILL)" >> "$LOG_FILE"
    fi
    break
  fi

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ ! -f "$EXIT_CODE_FILE" ]; then
  echo "TIMEOUT: Tests exceeded ${TIMEOUT}s. Killing tmux session."
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  echo "124" > "$EXIT_CODE_FILE"
  echo "TIMEOUT after ${TIMEOUT}s" >> "$LOG_FILE"
fi

EXIT_CODE=$(cat "$EXIT_CODE_FILE")
uv run python .claude-workflow/scripts/agent/parse_test_log.py --log "$LOG_FILE" --output "$SUMMARY_FILE" --exit-code "$EXIT_CODE" >/dev/null
uv run python - <<PY_ARTIFACT
import json
from pathlib import Path

payload = {
    "session_id": ${SESSION_ID@Q},
    "tmux_session": ${SESSION_NAME@Q},
    "log_path": ${LOG_FILE@Q},
    "summary_path": ${SUMMARY_FILE@Q},
    "exit_code_path": ${EXIT_CODE_FILE@Q},
}
Path(${ARTIFACTS_FILE@Q}).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY_ARTIFACT
echo "Tests completed with exit code: $EXIT_CODE"
exit 0
