#!/usr/bin/env bash
# Tells subagents not to ask users for flow selection.
# The parent agent has already determined the flow and work type.
# Used by SubagentStart hook.
set -euo pipefail

jq -n '{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "You are a subagent operating within an established flow. Your parent agent has already determined the flow and work type. Do NOT ask the user to choose a flow or classify the request. Execute your assigned work within the context provided by your parent agent."
  }
}'
