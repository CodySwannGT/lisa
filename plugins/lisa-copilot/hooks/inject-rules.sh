#!/usr/bin/env bash
# Reads all .md files from the plugin's rules/eager/ directory and injects them
# into the session context via additionalContext.
# Used by SessionStart and SubagentStart hooks.
#
# The split between eager and reference rules is documented in
# rules/eager/00-bootstrap.md (or the equivalent README). Reference bodies
# under rules/reference/ are installed alongside but loaded only when the
# eager breadcrumb points to them.
set -euo pipefail

RULES_DIR="${CLAUDE_PLUGIN_ROOT}/rules/eager"

# Backward compatibility: if the eager subdir is absent (older Lisa install),
# fall back to the flat rules/ directory so a partial upgrade still ships rules.
if [ ! -d "$RULES_DIR" ]; then
  RULES_DIR="${CLAUDE_PLUGIN_ROOT}/rules"
fi

# Bail silently if no rules directory at all
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
