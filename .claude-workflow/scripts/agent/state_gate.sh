#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AGENT_STATE_DIR="${ZOPLICATE_AGENT_STATE_DIR:-$PROJECT_DIR/.claude-workflow/state}"
STATE_FILE="$AGENT_STATE_DIR/runtime/working.json"

test -f "$STATE_FILE" || exit 0

if [[ "${ZOPLICATE_HOOK_MODE:-full}" == "minimal" ]]; then
  PARENT_PID=$(uv run python -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('parent_pid', ''))
except Exception:
    print('')
" "$STATE_FILE" 2>/dev/null)

  if [[ -z "$PARENT_PID" ]]; then
    exit 0
  fi
  if ! kill -0 "$PARENT_PID" 2>/dev/null; then
    exit 0
  fi
fi

eval "$(uv run python -c "
import json, re, sys
try:
    d = json.load(open(sys.argv[1]))
    phase = d.get('current_phase', '')
    phase = re.sub(r'[^a-z_]', '', phase)
    print(f'PHASE={phase}')
except Exception:
    print('PHASE=')
" "$STATE_FILE" 2>/dev/null)"

TARGET=$(uv run python -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get('file_path', d.get('path', '')))
except Exception:
    print('')
" <<< "$CLAUDE_TOOL_INPUT" 2>/dev/null)

case "$PHASE" in
  implement|refine|update_state)
    ;;
  plan|plan_review|test|code_review)
    case "$TARGET" in
      .claude-workflow/state/*|*/.claude-workflow/state/*)
        ;;
      *)
        echo "STATE GATE: repo file edits are blocked in phase=$PHASE. Use implement/refine/update_state."
        exit 2
        ;;
    esac
    ;;
  "")
    exit 0
    ;;
  *)
    echo "STATE GATE: Edit/Write blocked in phase=$PHASE. Allowed only in implement/refine/update_state."
    exit 2
    ;;
esac

exit 0
