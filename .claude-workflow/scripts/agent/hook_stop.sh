#!/usr/bin/env bash
set -euo pipefail

command -v uv >/dev/null 2>&1 || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
test -f "$PROJECT_DIR/.claude-workflow/scripts/ci/check_stop.py" || exit 0
cd "$PROJECT_DIR"
uv run python .claude-workflow/scripts/ci/check_stop.py
