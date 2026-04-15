#!/usr/bin/env bash
set -euo pipefail
#
# run_overnight.sh -- Batch milestone runner for unattended overnight execution
#
# Usage:
#   .claude-workflow/scripts/agent/run_overnight.sh [--halt-on-failure] [--auto-commit] <milestones-file>

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$PROJECT_DIR"

COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-60}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-7200}"
MAX_BUDGET_USD="${MAX_BUDGET_USD:-50}"
PERMISSION_MODE="${PERMISSION_MODE:-}"
HALT_ON_FAILURE=false
AUTO_COMMIT=false
MILESTONES_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --halt-on-failure)
      HALT_ON_FAILURE=true
      shift
      ;;
    --auto-commit)
      AUTO_COMMIT=true
      shift
      ;;
    -h|--help)
      head -18 "$0" | tail -16
      exit 0
      ;;
    *)
      MILESTONES_FILE="$1"
      shift
      ;;
  esac
done

if [[ -z "$MILESTONES_FILE" ]]; then
  echo "Error: milestones file required."
  echo "Usage: .claude-workflow/scripts/agent/run_overnight.sh [--halt-on-failure] [--auto-commit] <milestones-file>"
  exit 1
fi

if [[ ! -f "$MILESTONES_FILE" ]]; then
  echo "Error: milestones file not found: $MILESTONES_FILE"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found in PATH."
  exit 1
fi

if ! command -v tmux &>/dev/null; then
  echo "Error: 'tmux' not found in PATH."
  exit 1
fi

if ! command -v timeout &>/dev/null; then
  echo "Error: 'timeout' command not found."
  exit 1
fi

if ! command -v uv &>/dev/null; then
  echo "Error: 'uv' not found in PATH."
  exit 1
fi

if [[ "$AUTO_COMMIT" == "true" ]] && ! command -v git &>/dev/null; then
  echo "Error: 'git' not found in PATH (required for --auto-commit)."
  exit 1
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
LOG_DIR=".claude-workflow/state/logs/overnight"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run_overnight_${TIMESTAMP}.log"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

git_worktree_clean() {
  local status_output
  if ! status_output=$(git status --porcelain 2>/dev/null); then
    return 1
  fi
  [[ -z "$status_output" ]]
}

ensure_auto_commit_ready() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "Error: --auto-commit requires running inside a git worktree."
    return 1
  fi

  if ! git_worktree_clean; then
    log "Error: --auto-commit requires a clean git worktree before starting."
    git status --short 2>&1 | tee -a "$LOG_FILE" >/dev/null || true
    return 1
  fi
}

build_commit_message() {
  local milestone_id="$1"
  uv run python -c "
import json, sys
from pathlib import Path

milestone_id = sys.argv[1]
spec_path = Path('.claude-workflow/docs/ai/milestones') / f'{milestone_id}.json'
with spec_path.open(encoding='utf-8') as handle:
    spec = json.load(handle)

summary = ''
title = spec.get('title')
goal = spec.get('goal')
if isinstance(title, str) and title.strip():
    summary = title.strip()
elif isinstance(goal, str) and goal.strip():
    summary = goal.strip()
else:
    raise SystemExit(2)

summary = ' '.join(summary.split())
print(f'{milestone_id}: {summary}')
" "$milestone_id"
}

commit_milestone() {
  local milestone_id="$1"
  local commit_message
  local commit_sha

  if ! commit_message=$(build_commit_message "$milestone_id" 2>>"$LOG_FILE"); then
    log "FAIL: $milestone_id auto-commit message generation failed."
    return 1
  fi

  log "Auto-commit: staging changes for $milestone_id."
  if ! git add -A >>"$LOG_FILE" 2>&1; then
    log "FAIL: $milestone_id git add -A failed."
    return 1
  fi

  log "Auto-commit: creating commit '$commit_message'."
  if ! git commit -m "$commit_message" >>"$LOG_FILE" 2>&1; then
    log "FAIL: $milestone_id git commit failed."
    return 1
  fi

  if ! commit_sha=$(git rev-parse HEAD 2>>"$LOG_FILE"); then
    log "FAIL: $milestone_id committed, but git rev-parse HEAD failed."
    return 1
  fi

  log "COMMIT: $commit_sha $commit_message"
}

TOTAL=0
PASSED=0
FAILED=0
TOTAL_MILESTONES=$(grep -cve '^[[:space:]]*#' -e '^[[:space:]]*$' "$MILESTONES_FILE")

log "=== Overnight batch run started ==="
log "Milestones file: $MILESTONES_FILE"
log "Halt on failure: $HALT_ON_FAILURE"
log "Auto-commit: $AUTO_COMMIT"
log "Cooldown: ${COOLDOWN_SECONDS}s | Timeout: ${TIMEOUT_SECONDS}s | Budget: \$${MAX_BUDGET_USD}/milestone"
log "Permission mode: $PERMISSION_MODE"
log ""

if [[ "$AUTO_COMMIT" == "true" ]] && ! ensure_auto_commit_ready; then
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// /}" ]] && continue

  MILESTONE_ID=$(echo "$line" | awk '{print $1}')
  if [[ -z "$MILESTONE_ID" ]]; then
    log "SKIP: Could not parse line: $line"
    continue
  fi

  TOTAL=$((TOTAL + 1))
  log "--- Milestone $TOTAL: $MILESTONE_ID ---"

  PROMPT="/milestone-loop milestone=${MILESTONE_ID} approval=auto watchdog_stale_minutes=60"
  CLAUDE_ARGS=(-p "$PROMPT" --max-budget-usd "$MAX_BUDGET_USD")
  if [[ -n "$PERMISSION_MODE" ]]; then
    CLAUDE_ARGS+=(--permission-mode "$PERMISSION_MODE")
  fi

  log "Invoking: claude ${CLAUDE_ARGS[*]}"

  set +e
  timeout "$TIMEOUT_SECONDS" claude "${CLAUDE_ARGS[@]}" >>"$LOG_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  if [[ $EXIT_CODE -eq 124 ]]; then
    log "TIMEOUT: $MILESTONE_ID exceeded ${TIMEOUT_SECONDS}s hard ceiling."
    FAILED=$((FAILED + 1))
  elif [[ $EXIT_CODE -ne 0 ]]; then
    log "FAIL: $MILESTONE_ID exited with code $EXIT_CODE."
    FAILED=$((FAILED + 1))
  else
    if uv run python -c "
import json, sys
s = json.load(open('.claude-workflow/docs/ai/project_snapshot.json'))
sys.exit(0 if s.get('latest_accepted_milestone') == sys.argv[1] else 1)
" "$MILESTONE_ID" 2>/dev/null; then
      if [[ "$AUTO_COMMIT" == "true" ]]; then
        if commit_milestone "$MILESTONE_ID"; then
          log "PASS: $MILESTONE_ID completed successfully (verified, committed)."
          PASSED=$((PASSED + 1))
        else
          FAILED=$((FAILED + 1))
          EXIT_CODE=1
        fi
      else
        log "PASS: $MILESTONE_ID completed successfully (verified)."
        PASSED=$((PASSED + 1))
      fi
    else
      log "FAIL: $MILESTONE_ID -- Claude exited cleanly but milestone was NOT accepted."
      FAILED=$((FAILED + 1))
      EXIT_CODE=1
    fi
  fi

  if [[ "$AUTO_COMMIT" == "true" && $EXIT_CODE -ne 0 ]] && ! git_worktree_clean; then
    log "Halting: auto-commit requires a clean git worktree after failure; detected uncommitted changes after $MILESTONE_ID."
    break
  fi

  if [[ "$HALT_ON_FAILURE" == "true" && $EXIT_CODE -ne 0 ]]; then
    log "Halting: --halt-on-failure is set and $MILESTONE_ID failed."
    break
  fi

  if [[ $TOTAL -lt $TOTAL_MILESTONES ]]; then
    log "Cooldown: sleeping ${COOLDOWN_SECONDS}s before next milestone..."
    sleep "$COOLDOWN_SECONDS"
  fi
done < "$MILESTONES_FILE"

log ""
log "=== Overnight batch run complete ==="
log "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"
log "Log: $LOG_FILE"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
