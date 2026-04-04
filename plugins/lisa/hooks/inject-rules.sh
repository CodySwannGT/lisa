#!/usr/bin/env bash
# Reads all .md files from the plugin's rules/ directory and injects them
# into the session context via additionalContext.
# Used by SessionStart and SubagentStart hooks.
set -euo pipefail

RULES_DIR="${CLAUDE_PLUGIN_ROOT}/rules"

# Bail silently if no rules directory
[ -d "$RULES_DIR" ] || exit 0

CONTEXT=""
for file in "$RULES_DIR"/*.md; do
  [ -f "$file" ] || continue
  CONTEXT+="$(cat "$file")"$'\n\n'
done

# Bail if no rules found
[ -n "$CONTEXT" ] || exit 0

# Output as JSON — jq handles escaping
jq -n --arg ctx "$CONTEXT" '{"additionalContext": $ctx}'
