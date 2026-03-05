#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Verification Level Enforcement Hook (Stop)
# =============================================================================
# Checks whether the agent declared a verification level when the session
# involved code changes. Does NOT re-run lint/typecheck/tests (husky does that).
#
# Logic:
#   1. If no Write/Edit tools were used → exit 0 (research/conversation only)
#   2. If code was written → check last assistant message for verification level
#   3. If verification level found → exit 0
#   4. If missing and stop_hook_active is false → block with instructions
#   5. If missing and stop_hook_active is true → exit 0 (avoid infinite loops)
#
# @see .claude/rules/verfication.md "Self-Correction Loop" section
# =============================================================================

# Read JSON input from stdin
INPUT=$(cat)

# Extract transcript path
TRANSCRIPT_PATH=$(echo "$INPUT" | grep -o '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')

# Exit silently if no transcript available
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    exit 0
fi

# Check if Write or Edit tools were used during the session
# Look for tool_use entries with Write or Edit tool names
if ! grep -q '"tool_name"[[:space:]]*:[[:space:]]*"\(Write\|Edit\|NotebookEdit\)"' "$TRANSCRIPT_PATH" 2>/dev/null; then
    # No code changes — this was research/conversation, allow stop
    exit 0
fi

# Code was written — check if a verification level was declared
# Extract the last assistant message
LAST_ASSISTANT=$(awk '/"type"[[:space:]]*:[[:space:]]*"assistant"/{line=$0} END{if(line) print line}' "$TRANSCRIPT_PATH" 2>/dev/null)

if [ -z "$LAST_ASSISTANT" ]; then
    exit 0
fi

# Extract the text content from the assistant message
RESPONSE_TEXT=""
if command -v jq >/dev/null 2>&1; then
    RESPONSE_TEXT=$(echo "$LAST_ASSISTANT" | jq -r '.message.content[] | select(.type == "text") | .text' 2>/dev/null)
else
    RESPONSE_TEXT=$(echo "$LAST_ASSISTANT" | grep -o '"text"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | sed 's/"$//')
fi

if [ -z "$RESPONSE_TEXT" ]; then
    exit 0
fi

# Check for verification level keywords (case-insensitive)
if echo "$RESPONSE_TEXT" | grep -qi "FULLY VERIFIED\|PARTIALLY VERIFIED\|UNVERIFIED"; then
    exit 0
fi

# Check if this is a retry (stop_hook_active flag)
# The stop_hook_active field is set to true when a Stop hook has already blocked once
STOP_HOOK_ACTIVE=$(echo "$INPUT" | grep -o '"stop_hook_active"[[:space:]]*:[[:space:]]*true' || echo "")

if [ -n "$STOP_HOOK_ACTIVE" ]; then
    # Already blocked once — allow stop to prevent infinite loop
    exit 0
fi

# No verification level declared after code changes — block
cat << 'EOF'
{"decision":"block","reason":"You changed code but didn't declare a verification level. Run your verification, then declare FULLY VERIFIED, PARTIALLY VERIFIED, or UNVERIFIED with evidence. See .claude/rules/verfication.md for requirements."}
EOF

exit 0
