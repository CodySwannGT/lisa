#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# CLAUDE.md Compliance Hook - "I'm tired boss" Verification
# =============================================================================
# Verifies Claude's response starts with "I'm tired boss" as required by
# CLAUDE.md. This is a Stop hook that blocks if Claude doesn't comply,
# forcing a retry with an error message.
#
# @see CLAUDE.md - "Always output 'I'm tired boss' before starting any task"
# =============================================================================

# Read JSON input from stdin
INPUT=$(cat)

# Extract transcript path
TRANSCRIPT_PATH=$(echo "$INPUT" | grep -o '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Exit silently if no transcript available
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    exit 0
fi

# Extract the last assistant message from the transcript
# Use awk for cross-platform compatibility (tac not available on macOS)
LAST_ASSISTANT=$(awk '/"type"[[:space:]]*:[[:space:]]*"assistant"/{line=$0} END{if(line) print line}' "$TRANSCRIPT_PATH" 2>/dev/null)

if [ -z "$LAST_ASSISTANT" ]; then
    exit 0
fi

# Extract the text content from the assistant message
# Use jq for robust JSON parsing when available, fallback to grep/sed
RESPONSE_TEXT=""
if command -v jq >/dev/null 2>&1; then
    RESPONSE_TEXT=$(echo "$LAST_ASSISTANT" | jq -r '.message.content[] | select(.type == "text") | .text' 2>/dev/null | head -1)
else
    # Fallback: simple regex extraction (may fail on escaped quotes)
    RESPONSE_TEXT=$(echo "$LAST_ASSISTANT" | grep -o '"text"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//' | sed 's/"$//')
fi

# Exit if no text content found
if [ -z "$RESPONSE_TEXT" ]; then
    exit 0
fi

# Check if response starts with "I'm tired boss" (case-sensitive)
REQUIRED_PHRASE="I'm tired boss"
if echo "$RESPONSE_TEXT" | head -1 | grep -q "^$REQUIRED_PHRASE"; then
    # Compliance verified
    exit 0
fi

# Non-compliant - block and provide feedback
# Output JSON to block the Stop event
cat << 'EOF'
{"decision":"block","reason":"Your response did not start with \"I'm tired boss\". Read @CLAUDE.md and try again. Every response MUST begin with this exact phrase."}
EOF

exit 0
