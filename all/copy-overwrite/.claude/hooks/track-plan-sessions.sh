#!/usr/bin/env bash
#
# track-plan-sessions.sh - Tracks which sessions work on each plan file
#
# Triggered by two hooks:
#   1. PostToolUse (Write|Edit) - Detects plan file writes via absolute path comparison
#      and stamps session ID into the plan's ## Sessions table
#   2. UserPromptSubmit - Finds the most recently modified .md file in plans/
#      and stamps session ID into its ## Sessions table
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

PLAN_FILE=""

if [[ "$HOOK_EVENT" == "PostToolUse" ]]; then
  # Trigger A: Plan file was written/edited
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

  if [[ -z "$FILE_PATH" ]]; then
    exit 0
  fi

  # Resolve PLANS_DIR to absolute path for comparison
  ABS_PLANS_DIR=$(cd "$PLANS_DIR" 2>/dev/null && pwd)

  if [[ -z "$ABS_PLANS_DIR" ]]; then
    exit 0
  fi

  # Check if the written file is in the plans directory
  if [[ "$FILE_PATH" == "$ABS_PLANS_DIR"/* ]]; then
    PLAN_FILE="$FILE_PATH"
  else
    exit 0
  fi

elif [[ "$HOOK_EVENT" == "UserPromptSubmit" ]]; then
  # Trigger B: Find the most recently modified .md file in plans directory
  PLAN_FILE=$(ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1)

  if [[ -z "$PLAN_FILE" || ! -f "$PLAN_FILE" ]]; then
    exit 0
  fi
else
  exit 0
fi

# Verify the plan file exists
if [[ ! -f "$PLAN_FILE" ]]; then
  exit 0
fi

# Check if session ID already exists in the file (dedup)
if grep -qF "$SESSION_ID" "$PLAN_FILE" 2>/dev/null; then
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

exit 0
