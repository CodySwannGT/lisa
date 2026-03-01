#!/bin/bash
##
# Debug hook that logs all hook events when CLAUDE_DEBUG=1
# This script is a no-op when CLAUDE_DEBUG is not set or set to 0
##

# Exit immediately if debug mode is not enabled
if [[ "${CLAUDE_DEBUG:-0}" != "1" ]]; then
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

# Parse hook event info using jq
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "N/A"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"')
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "unknown"')

# Create debug log directory if it doesn't exist
DEBUG_LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/debug"
mkdir -p "$DEBUG_LOG_DIR"

# Log file with session ID
LOG_FILE="$DEBUG_LOG_DIR/hooks-${SESSION_ID}.log"

# Timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Log the event
{
  echo "[$TIMESTAMP] Hook: $HOOK_EVENT"
  echo "  Tool: $TOOL_NAME"
  echo "  Session: $SESSION_ID"
  echo "  CWD: $CWD"
  echo "  Permission Mode: $PERMISSION_MODE"
  echo "  Full Input:"
  echo "$INPUT" | jq '.' | sed 's/^/    /'
  echo "---"
} >> "$LOG_FILE"

# Also output to stderr in verbose mode (won't affect Claude)
echo "[DEBUG] Hook fired: $HOOK_EVENT (tool: $TOOL_NAME)" >&2

exit 0
