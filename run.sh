#!/usr/bin/env bash
set -euo pipefail
#
# run.sh -- Run a single Zoplicate Claude workflow milestone.
#
# Usage:
#   ./run.sh <MILESTONE_ID> [approval_mode]
#
# Examples:
#   ./run.sh M001
#   ./run.sh M001 manual
#
# Environment variables:
#   TIMEOUT_SECONDS   -- Hard ceiling per milestone (default: 7200 = 2 hours)
#   MAX_BUDGET_USD    -- Max Claude API spend (default: 10)
#   PERMISSION_MODE   -- Optional Claude CLI permission mode override.
#                        Defaults to .claude/settings.json permissions.defaultMode.
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

WORKFLOW_ROOT="${PROJECT_DIR}/.claude-workflow"
DOCS_AI_DIR="${WORKFLOW_ROOT}/docs/ai"
MILESTONE_DIR="${DOCS_AI_DIR}/milestones"
SNAPSHOT_FILE="${DOCS_AI_DIR}/project_snapshot.json"
LOG_DIR="${WORKFLOW_ROOT}/state/logs/runs"
SETTINGS_FILE="${PROJECT_DIR}/.claude/settings.json"

is_approval_mode() {
  [[ "$1" == "manual" || "$1" == "auto" ]]
}

usage() {
  echo "Usage: ./run.sh <MILESTONE_ID> [approval_mode]"
  echo "  MILESTONE_ID   e.g. M001"
  echo "  approval_mode  manual|auto (default: auto)"
}

read_permission_mode_from_settings() {
  uv run python -c '
import json
import sys
from pathlib import Path

settings_path = Path(sys.argv[1])
if not settings_path.exists():
    sys.exit(0)

settings = json.loads(settings_path.read_text(encoding="utf-8"))
permission_mode = settings.get("permissions", {}).get("defaultMode", "")
if isinstance(permission_mode, str) and permission_mode.strip():
    print(permission_mode.strip())
' "$SETTINGS_FILE"
}

verify_milestone_accepted() {
  local milestone_id="$1"
  uv run python -c '
import json
import sys
from pathlib import Path

snapshot_path = Path(sys.argv[1])
milestone_id = sys.argv[2]
snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
sys.exit(0 if snapshot.get("latest_accepted_milestone") == milestone_id else 1)
' "$SNAPSHOT_FILE" "$milestone_id"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

MILESTONE="$1"
APPROVAL="${2:-auto}"

if ! is_approval_mode "$APPROVAL"; then
  echo "Error: invalid approval mode: $APPROVAL"
  usage
  exit 1
fi

if [[ $# -gt 2 ]]; then
  echo "Error: too many arguments."
  usage
  exit 1
fi

TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-7200}"
MAX_BUDGET_USD="${MAX_BUDGET_USD:-10}"
PERMISSION_MODE="${PERMISSION_MODE:-}"

if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found in PATH."
  exit 1
fi

if ! command -v tmux &>/dev/null; then
  echo "Error: 'tmux' not found in PATH (required by the workflow watchdog)."
  exit 1
fi

if ! command -v timeout &>/dev/null; then
  echo "Error: 'timeout' command not found in PATH."
  exit 1
fi

if ! command -v uv &>/dev/null; then
  echo "Error: 'uv' not found in PATH."
  exit 1
fi

if [[ ! -d "$WORKFLOW_ROOT" ]]; then
  echo "Error: workflow root not found: $WORKFLOW_ROOT"
  exit 1
fi

SPEC_FILE="${MILESTONE_DIR}/${MILESTONE}.json"
if [[ ! -f "$SPEC_FILE" ]]; then
  echo "Error: milestone spec not found: $SPEC_FILE"
  exit 1
fi

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "Error: project snapshot not found: $SNAPSHOT_FILE"
  exit 1
fi

if [[ -z "$PERMISSION_MODE" ]]; then
  PERMISSION_MODE="$(read_permission_mode_from_settings)"
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/run_${MILESTONE}_${TIMESTAMP}.log"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

export CLAUDE_PROJECT_DIR="$PROJECT_DIR"

PROMPT="/milestone-loop milestone=${MILESTONE} approval=${APPROVAL} watchdog_stale_minutes=60"
CLAUDE_ARGS=(-p "$PROMPT" --max-budget-usd "$MAX_BUDGET_USD")
if [[ -n "$PERMISSION_MODE" ]]; then
  CLAUDE_ARGS+=(--permission-mode "$PERMISSION_MODE")
fi

log "=== Running milestone ${MILESTONE} ==="
log "Project: ${PROJECT_DIR}"
log "Spec: ${SPEC_FILE}"
log "Approval: ${APPROVAL} | Timeout: ${TIMEOUT_SECONDS}s | Budget: \$${MAX_BUDGET_USD}"
log "Permission mode: ${PERMISSION_MODE:-project settings}"
log "Prompt: ${PROMPT}"
log ""

set +e
timeout "$TIMEOUT_SECONDS" claude "${CLAUDE_ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}
set -e

log ""
if [[ $EXIT_CODE -eq 124 ]]; then
  log "TIMEOUT: ${MILESTONE} exceeded ${TIMEOUT_SECONDS}s hard ceiling."
elif [[ $EXIT_CODE -ne 0 ]]; then
  log "FAIL: ${MILESTONE} exited with code ${EXIT_CODE}."
elif verify_milestone_accepted "$MILESTONE" 2>/dev/null; then
  log "PASS: ${MILESTONE} completed successfully (verified)."
else
  log "FAIL: ${MILESTONE} -- Claude exited cleanly but milestone was NOT accepted."
  log "  ${SNAPSHOT_FILE} latest_accepted_milestone does not match ${MILESTONE}."
  EXIT_CODE=1
fi

log "Log: ${LOG_FILE}"
exit "$EXIT_CODE"
