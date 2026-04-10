#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$PROJECT_DIR"
uv run python .claude-workflow/scripts/agent/state_manager.py --project-dir "$PROJECT_DIR" validate
