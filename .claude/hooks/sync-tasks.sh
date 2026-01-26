#!/usr/bin/env bash
#
# sync-tasks.sh - Syncs Claude Code tasks to project directories
#
# This hook is triggered on PostToolUse for TaskCreate and TaskUpdate.
# It reads the task metadata to determine the project and syncs
# task JSON files to ./projects/{project}/tasks/{session-id}/
#
# This session-based structure preserves task history across /clear commands,
# preventing overwrites when new sessions create tasks with the same IDs.
#
# Input (via stdin): JSON with tool_name, tool_input, tool_output
#

set -euo pipefail

# Read JSON input from stdin
INPUT=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only process TaskCreate and TaskUpdate
if [[ "$TOOL_NAME" != "TaskCreate" && "$TOOL_NAME" != "TaskUpdate" ]]; then
  exit 0
fi

# Try to get project from multiple sources:
# 1. Task metadata (passed in tool_input)
# 2. .claude-active-project marker file

PROJECT=""

# Check tool_input metadata for project
PROJECT=$(echo "$INPUT" | jq -r '.tool_input.metadata.project // empty')

# If no project in metadata, check marker file
if [[ -z "$PROJECT" && -f ".claude-active-project" ]]; then
  PROJECT=$(cat .claude-active-project | tr -d '[:space:]')
fi

# If still no project, skip syncing
if [[ -z "$PROJECT" ]]; then
  exit 0
fi

# Validate project name (kebab-case, no path traversal)
if [[ ! "$PROJECT" =~ ^[a-z0-9-]+$ ]]; then
  echo "Warning: Invalid project name '$PROJECT', skipping sync" >&2
  exit 0
fi

# Get task ID
TASK_ID=""
if [[ "$TOOL_NAME" == "TaskCreate" ]]; then
  # For TaskCreate, ID is in tool_output
  TASK_ID=$(echo "$INPUT" | jq -r '.tool_output.taskId // .tool_output.id // empty')
elif [[ "$TOOL_NAME" == "TaskUpdate" ]]; then
  # For TaskUpdate, ID is in tool_input
  TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.taskId // empty')
fi

if [[ -z "$TASK_ID" ]]; then
  exit 0
fi

# Find the task file in ~/.claude/tasks/
# Tasks are stored in ~/.claude/tasks/{session-uuid}/{id}.json
CLAUDE_TASKS_DIR="${HOME}/.claude/tasks"
TASK_FILE=""

# Get session ID from hook input (preferred - 100% accurate)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [[ -n "$SESSION_ID" && -f "${CLAUDE_TASKS_DIR}/${SESSION_ID}/${TASK_ID}.json" ]]; then
  # Use session ID directly - guaranteed correct session
  TASK_FILE="${CLAUDE_TASKS_DIR}/${SESSION_ID}/${TASK_ID}.json"
else
  # Fallback: find most recently modified task file with this ID
  # This handles edge cases where session_id isn't available
  TASK_FILE=$(find "$CLAUDE_TASKS_DIR" -name "${TASK_ID}.json" -exec stat -f '%m %N' {} \; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
fi

if [[ -z "$TASK_FILE" || ! -f "$TASK_FILE" ]]; then
  exit 0
fi

# Require session ID for proper history tracking
if [[ -z "$SESSION_ID" ]]; then
  echo "Warning: No session_id available, skipping sync" >&2
  exit 0
fi

# Ensure project tasks directory exists (includes session ID for history preservation)
PROJECT_TASKS_DIR="./projects/${PROJECT}/tasks/${SESSION_ID}"
mkdir -p "$PROJECT_TASKS_DIR"

# Copy task file to project directory
cp "$TASK_FILE" "${PROJECT_TASKS_DIR}/${TASK_ID}.json"

# Optionally stage the file for git (non-blocking)
git add "${PROJECT_TASKS_DIR}/${TASK_ID}.json" 2>/dev/null || true

exit 0
