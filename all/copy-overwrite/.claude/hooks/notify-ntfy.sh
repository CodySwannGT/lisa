#!/bin/bash
# =============================================================================
# ntfy.sh Notification Hook for Claude Code
# =============================================================================
# Sends desktop and mobile notifications via ntfy.sh when Claude needs
# attention or finishes a task.
#
# Setup:
#   1. Install ntfy app on mobile (iOS App Store / Android Play Store)
#   2. Subscribe to your unique topic in the app
#   3. Set NTFY_TOPIC environment variable (e.g., in ~/.bashrc or ~/.zshrc):
#      export NTFY_TOPIC="my-claude-alerts-xyz123"
#
# @see https://ntfy.sh
# =============================================================================

# Read JSON input from stdin
INPUT=$(cat)

# Extract hook event name
HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Extract notification type (for Notification hooks)
NOTIFICATION_TYPE=$(echo "$INPUT" | grep -o '"notification_type"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Extract message if available
MESSAGE=$(echo "$INPUT" | grep -o '"message"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Extract session ID (first 8 chars for brevity)
FULL_SESSION_ID=$(echo "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')
SESSION_ID="${FULL_SESSION_ID:0:8}"

# Extract transcript path for task summary
TRANSCRIPT_PATH=$(echo "$INPUT" | grep -o '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Determine source (Web vs Local)
if [ "$CLAUDE_CODE_REMOTE" = "true" ]; then
    SOURCE="Web"
else
    SOURCE="Local"
fi

# Get project name from current directory
PROJECT_NAME=$(basename "$CLAUDE_PROJECT_DIR" 2>/dev/null || basename "$(pwd)")

# Load NTFY_TOPIC from local config if not already set
if [ -z "$NTFY_TOPIC" ]; then
    # Check for project-local config (gitignored)
    if [ -f "$CLAUDE_PROJECT_DIR/.claude/env.local" ]; then
        # shellcheck source=/dev/null
        source "$CLAUDE_PROJECT_DIR/.claude/env.local"
    fi
    # Check for user-global config
    if [ -z "$NTFY_TOPIC" ] && [ -f "$HOME/.claude/env.local" ]; then
        # shellcheck source=/dev/null
        source "$HOME/.claude/env.local"
    fi
fi

# Exit silently if still not configured
if [ -z "$NTFY_TOPIC" ]; then
    exit 0
fi

# Extract task summary from transcript (last assistant message, truncated)
TASK_SUMMARY=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    # Get the last assistant message from the JSONL transcript
    # The transcript contains lines with "type":"assistant" and "message" content
    # Use awk for cross-platform compatibility (tac is not available on macOS)
    LAST_ASSISTANT=$(awk '/"type"[[:space:]]*:[[:space:]]*"assistant"/{line=$0} END{if(line) print line}' "$TRANSCRIPT_PATH" 2>/dev/null)
    if [ -n "$LAST_ASSISTANT" ]; then
        # Extract the message content - look for text content in the message
        # Format: {"message":{"content":[{"type":"text","text":"..."}]}}
        # Use jq for robust JSON parsing when available, fallback to grep/sed
        if command -v jq >/dev/null 2>&1; then
            RAW_SUMMARY=$(echo "$LAST_ASSISTANT" | jq -r '.message.content[] | select(.type == "text") | .text' 2>/dev/null | head -1)
        else
            # Fallback: simple regex extraction (may fail on escaped quotes)
            RAW_SUMMARY=$(echo "$LAST_ASSISTANT" | grep -o '"text"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//' | sed 's/"$//')
        fi
        if [ -n "$RAW_SUMMARY" ]; then
            # Truncate to 100 chars and clean up newlines
            TASK_SUMMARY=$(echo "$RAW_SUMMARY" | tr '\n' ' ' | cut -c1-100)
            # Add ellipsis if truncated
            if [ ${#RAW_SUMMARY} -gt 100 ]; then
                TASK_SUMMARY="${TASK_SUMMARY}..."
            fi
        fi
    fi
fi

# Build session info string (shown in body)
SESSION_INFO=""
if [ -n "$SESSION_ID" ]; then
    SESSION_INFO="Session: $SESSION_ID"
fi

# Determine notification title and body based on hook type
case "$HOOK_EVENT" in
    "Notification")
        case "$NOTIFICATION_TYPE" in
            "permission_prompt")
                TITLE="Claude [$SOURCE] - Permission Required"
                BODY="${MESSAGE:-Claude needs your permission to continue}"
                if [ -n "$SESSION_INFO" ]; then
                    BODY="$SESSION_INFO
$BODY"
                fi
                PRIORITY="high"
                TAGS="warning"
                ;;
            "idle_prompt")
                TITLE="Claude [$SOURCE] - Waiting"
                BODY="${MESSAGE:-Claude is waiting for your input}"
                if [ -n "$SESSION_INFO" ]; then
                    BODY="$SESSION_INFO
$BODY"
                fi
                PRIORITY="default"
                TAGS="hourglass"
                ;;
            *)
                TITLE="Claude [$SOURCE] - Attention"
                BODY="${MESSAGE:-Claude needs your attention}"
                if [ -n "$SESSION_INFO" ]; then
                    BODY="$SESSION_INFO
$BODY"
                fi
                PRIORITY="default"
                TAGS="bell"
                ;;
        esac
        ;;
    "Stop")
        TITLE="Claude [$SOURCE] - Finished"
        BODY="$PROJECT_NAME"
        if [ -n "$SESSION_INFO" ]; then
            BODY="$SESSION_INFO | $BODY"
        fi
        if [ -n "$TASK_SUMMARY" ]; then
            BODY="$BODY
$TASK_SUMMARY"
        fi
        PRIORITY="default"
        TAGS="white_check_mark"
        ;;
    "SubagentStop")
        TITLE="Claude [$SOURCE] - Subagent Done"
        BODY="$PROJECT_NAME"
        if [ -n "$SESSION_INFO" ]; then
            BODY="$SESSION_INFO | $BODY"
        fi
        if [ -n "$TASK_SUMMARY" ]; then
            BODY="$BODY
$TASK_SUMMARY"
        fi
        PRIORITY="low"
        TAGS="checkered_flag"
        ;;
    *)
        TITLE="Claude [$SOURCE]"
        BODY="${MESSAGE:-Event: $HOOK_EVENT}"
        if [ -n "$SESSION_INFO" ]; then
            BODY="$SESSION_INFO
$BODY"
        fi
        PRIORITY="default"
        TAGS="robot"
        ;;
esac

# Send notification via ntfy.sh
curl -s \
    -H "Title: $TITLE" \
    -H "Priority: $PRIORITY" \
    -H "Tags: $TAGS" \
    -d "$BODY" \
    "https://ntfy.sh/$NTFY_TOPIC" > /dev/null 2>&1

exit 0
