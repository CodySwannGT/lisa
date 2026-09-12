#!/usr/bin/env bash
# Reads the plugin's EAGER rules and injects them into the session context.
#
# `rules/eager/` only, and deliberately with NO fallback to a flat `rules/`.
# This plugin's rules and this script ship in the same directory and are
# installed as one unit, so there is no vintage in which a split script meets an
# unsplit rules tree. A fallback here would buy nothing and cost the thing it
# already cost once: this plugin shipped its whole rule body flat for months and
# no surface complained, because a fallback that quietly succeeds is
# indistinguishable from a tree that was never split (#3993). With the branch
# gone, an unsplit tree injects nothing and is noticed.
#
# Reference bodies under `rules/reference/` install alongside and are read only
# when an eager breadcrumb points at one.
set -euo pipefail

INPUT=$(cat 2>/dev/null || true)
if [ -n "$INPUT" ]; then
  HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "SessionStart"' 2>/dev/null || echo "SessionStart")
else
  HOOK_EVENT="SessionStart"
fi

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RULES_DIR="$ROOT/rules/eager"

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
jq -n --arg event "$HOOK_EVENT" --arg ctx "$CONTEXT" '{"hookSpecificOutput": {"hookEventName": $event, "additionalContext": $ctx}}'
