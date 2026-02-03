#!/usr/bin/env bash
#
# track-plan-sessions.sh - Tracks which sessions work on each plan file
#
# Triggered by two hooks:
#   1. PostToolUse (Write|Edit) - Detects plan file writes via absolute path comparison,
#      stamps session ID into the plan's ## Sessions table, and saves a session-specific
#      marker file so subsequent UserPromptSubmit events can reliably find the active plan.
#   2. UserPromptSubmit - Finds the active plan file by checking for a session-specific
#      marker file first (set by PostToolUse), falling back to the most recently CREATED
#      .md file in plans/ (ls -tU on macOS sorts by birth time). This avoids the mtime bug
#      where another plan file's modification time (e.g., from a hook writing a session ID
#      to it, or format-on-edit touching it) could cause the wrong file to appear "newest."
#
# Marker files: $PLANS_DIR/.active-plan-<session-id> contain the absolute path to the
# active plan file. Stale markers (>24h) are cleaned up on each invocation.
#
# Debug logging: All key decisions are logged to $PLANS_DIR/.track-plan-debug.log for
# diagnostics if session IDs land in the wrong plan file.
#
# Input (via stdin): JSON with session_id, permission_mode, hook_event_name, etc.
#

set -euo pipefail

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')

# Session ID is required
if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

# Resolve plans directory from settings (default ./plans)
PLANS_DIR="./plans"
SETTINGS_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  CONFIGURED_DIR=$(jq -r '.plansDirectory // empty' "$SETTINGS_FILE")
  if [[ -n "$CONFIGURED_DIR" ]]; then
    PLANS_DIR="$CONFIGURED_DIR"
  fi
fi

# Debug logging
DEBUG_LOG="$PLANS_DIR/.track-plan-debug.log"

log_debug() {
  printf '[%s] [%s] [%s] %s\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$SESSION_ID" \
    "$HOOK_EVENT" \
    "$1" >> "$DEBUG_LOG" 2>/dev/null || true
}

# Session-specific marker file for reliable active-plan detection
MARKER_FILE="$PLANS_DIR/.active-plan-${SESSION_ID}"

# Clean stale marker files older than 24h
find "$PLANS_DIR" -name ".active-plan-*" -mmin +1440 -delete 2>/dev/null || true

PLAN_FILE=""
RESOLUTION_METHOD=""

if [[ "$HOOK_EVENT" == "PostToolUse" ]]; then
  # Trigger A: Plan file was written/edited
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

  if [[ -z "$FILE_PATH" ]]; then
    log_debug "PostToolUse: no file_path in tool_input, exiting"
    exit 0
  fi

  # Resolve PLANS_DIR to absolute path for comparison
  ABS_PLANS_DIR=$(cd "$PLANS_DIR" 2>/dev/null && pwd)

  if [[ -z "$ABS_PLANS_DIR" ]]; then
    log_debug "PostToolUse: could not resolve PLANS_DIR=$PLANS_DIR to absolute path, exiting"
    exit 0
  fi

  # Check if the written file is in the plans directory
  if [[ "$FILE_PATH" == "$ABS_PLANS_DIR"/* ]]; then
    PLAN_FILE="$FILE_PATH"
    RESOLUTION_METHOD="PostToolUse-direct"
    log_debug "PostToolUse: matched plan file=$PLAN_FILE"

    # Save marker so UserPromptSubmit can find this plan reliably
    echo "$PLAN_FILE" > "$MARKER_FILE"
    log_debug "PostToolUse: saved marker file=$MARKER_FILE"
  else
    log_debug "PostToolUse: file_path=$FILE_PATH not in plans dir=$ABS_PLANS_DIR, exiting"
    exit 0
  fi

elif [[ "$HOOK_EVENT" == "UserPromptSubmit" ]]; then
  # Trigger B: Find the active plan file
  # Priority 1: Session-specific marker file (reliable — set by PostToolUse when plan was written)
  if [[ -f "$MARKER_FILE" ]]; then
    PLAN_FILE=$(cat "$MARKER_FILE")
    RESOLUTION_METHOD="marker-file"
    log_debug "UserPromptSubmit: resolved via marker file=$PLAN_FILE"
  else
    # Priority 2: Most recently CREATED file (ls -tU on macOS sorts by birth time)
    PLAN_FILE=$(ls -tU "$PLANS_DIR"/*.md 2>/dev/null | head -1)
    RESOLUTION_METHOD="fallback-ls-tU"
    log_debug "UserPromptSubmit: no marker file, fallback ls -tU resolved=$PLAN_FILE"
  fi

  if [[ -z "$PLAN_FILE" || ! -f "$PLAN_FILE" ]]; then
    log_debug "UserPromptSubmit: no valid plan file found, exiting"
    exit 0
  fi
else
  exit 0
fi

# Verify the plan file exists
if [[ ! -f "$PLAN_FILE" ]]; then
  log_debug "plan file=$PLAN_FILE does not exist, exiting"
  exit 0
fi

# Check if session ID already exists in the file (dedup)
if grep -qF "$SESSION_ID" "$PLAN_FILE" 2>/dev/null; then
  log_debug "dedup: session ID already in $PLAN_FILE (resolved via $RESOLUTION_METHOD), skipping write"
  exit 0
fi

# Determine phase from permission_mode
PHASE=$( [[ "$PERMISSION_MODE" == "plan" ]] && echo "plan" || echo "implement" )
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Check if ## Sessions section exists
if grep -q "^## Sessions" "$PLAN_FILE" 2>/dev/null; then
  # Append row to existing table
  printf '| %s | %s | %s |\n' "$SESSION_ID" "$TIMESTAMP" "$PHASE" >> "$PLAN_FILE"
else
  # Create ## Sessions section at end of file
  {
    echo ""
    echo "## Sessions"
    echo ""
    echo "<!-- Auto-maintained by track-plan-sessions.sh -->"
    echo "| Session ID | First Seen | Phase |"
    echo "|------------|------------|-------|"
    printf '| %s | %s | %s |\n' "$SESSION_ID" "$TIMESTAMP" "$PHASE"
  } >> "$PLAN_FILE"
fi

log_debug "wrote session to $PLAN_FILE (resolved via $RESOLUTION_METHOD, phase=$PHASE)"

exit 0
