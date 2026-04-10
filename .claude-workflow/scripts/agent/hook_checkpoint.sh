#!/usr/bin/env bash
set -euo pipefail

[[ "${ZOPLICATE_HOOK_MODE:-full}" == "minimal" ]] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AGENT_STATE_DIR="${ZOPLICATE_AGENT_STATE_DIR:-$PROJECT_DIR/.claude-workflow/state}"
STATE_FILE="$AGENT_STATE_DIR/runtime/working.json"
test -f "$STATE_FILE" || exit 0

uv run python -c "
import time, pathlib, sys
import os
cp_dir = pathlib.Path(os.environ.get('ZOPLICATE_AGENT_STATE_DIR', str(pathlib.Path(sys.argv[1]) / '.claude-workflow/state'))) / 'runtime/checkpoints'
if not cp_dir.is_dir():
    sys.exit(1)
files = list(cp_dir.glob('*.json'))
if not files:
    sys.exit(1)
newest = max(f.stat().st_mtime for f in files)
sys.exit(0 if time.time() - newest < 30 else 1)
" "$PROJECT_DIR" 2>/dev/null && exit 0

cd "$PROJECT_DIR"
uv run python .claude-workflow/scripts/agent/state_manager.py --project-dir "$PROJECT_DIR" checkpoint >/dev/null 2>&1 || true
