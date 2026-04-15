#!/usr/bin/env bash
set -euo pipefail
#
# run_multi.sh -- Run Zoplicate Claude workflow milestones sequentially.
#
# Usage:
#   ./run_multi.sh <MILESTONE_ID_1> [approval_mode_1] <MILESTONE_ID_2> [approval_mode_2] ...
#
# Examples:
#   ./run_multi.sh M001
#   ./run_multi.sh M001 manual M002 auto
#
# Environment variables:
#   COOLDOWN_SECONDS -- Delay between milestones (default: 60)
#   AUTO_COMMIT -- Forwarded to run.sh; commits after each verified milestone
#                  by default (set AUTO_COMMIT=false to disable).
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

WORKFLOW_ROOT="${PROJECT_DIR}/.claude-workflow"
DOCS_AI_DIR="${WORKFLOW_ROOT}/docs/ai"
MILESTONE_DIR="${DOCS_AI_DIR}/milestones"
SNAPSHOT_FILE="${DOCS_AI_DIR}/project_snapshot.json"
LOG_DIR="${WORKFLOW_ROOT}/state/logs/runs"
RUN_SCRIPT="${PROJECT_DIR}/run.sh"

is_approval_mode() {
  [[ "$1" == "manual" || "$1" == "auto" ]]
}

usage() {
  echo "Usage: ./run_multi.sh <MILESTONE_ID_1> [approval_mode_1] <MILESTONE_ID_2> [approval_mode_2] ..."
  echo "  MILESTONE_ID   e.g. M001"
  echo "  approval_mode  manual|auto (default: auto)"
  echo "  COOLDOWN_SECONDS  delay between milestones in seconds (default: 60)"
  echo "  AUTO_COMMIT    true|false env var forwarded to run.sh (default: true)"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-60}"
MILESTONES=()
APPROVALS=()
while [[ $# -gt 0 ]]; do
  MILESTONE="$1"
  shift

  APPROVAL="auto"
  if [[ $# -gt 0 ]] && is_approval_mode "$1"; then
    APPROVAL="$1"
    shift
  fi

  MILESTONES+=("$MILESTONE")
  APPROVALS+=("$APPROVAL")
done

if [[ ! -x "$RUN_SCRIPT" ]]; then
  echo "Error: run script is not executable: $RUN_SCRIPT"
  exit 1
fi

if [[ ! -d "$WORKFLOW_ROOT" ]]; then
  echo "Error: workflow root not found: $WORKFLOW_ROOT"
  exit 1
fi

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "Error: project snapshot not found: $SNAPSHOT_FILE"
  exit 1
fi

for milestone in "${MILESTONES[@]}"; do
  spec_file="${MILESTONE_DIR}/${milestone}.json"
  if [[ ! -f "$spec_file" ]]; then
    echo "Error: milestone spec not found: $spec_file"
    exit 1
  fi
done

TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/run_multi_${TIMESTAMP}.log"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

log "=== Multi-milestone run started ==="
log "Project: ${PROJECT_DIR}"
log "Snapshot: ${SNAPSHOT_FILE}"
log "Count: ${#MILESTONES[@]}"
log "Cooldown: ${COOLDOWN_SECONDS}s"
log "Auto-commit: ${AUTO_COMMIT:-true} (handled by run.sh after each verified milestone)"
log ""

for i in "${!MILESTONES[@]}"; do
  MILESTONE="${MILESTONES[$i]}"
  APPROVAL="${APPROVALS[$i]}"

  log "=== Running milestone ${MILESTONE} with approval mode ${APPROVAL} ==="

  set +e
  "$RUN_SCRIPT" "$MILESTONE" "$APPROVAL" 2>&1 | tee -a "$LOG_FILE"
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [[ $EXIT_CODE -ne 0 ]]; then
    log "FAIL: ${MILESTONE} stopped the sequence with exit code ${EXIT_CODE}."
    log "Log: ${LOG_FILE}"
    exit "$EXIT_CODE"
  fi

  if [[ "${AUTO_COMMIT:-true}" == "true" ]]; then
    log "PASS: ${MILESTONE} completed and verified (auto-commit handled by run.sh)."
  else
    log "PASS: ${MILESTONE} completed and verified."
  fi

  if [[ $i -lt $((${#MILESTONES[@]} - 1)) ]]; then
    log "Cooldown: sleeping ${COOLDOWN_SECONDS}s before next milestone..."
    sleep "$COOLDOWN_SECONDS"
  fi

  log ""
done

log "=== Multi-milestone run complete ==="
log "Log: ${LOG_FILE}"
exit 0
