#!/usr/bin/env bash
# Reads all .md files from the plugin's rules/eager/ directory and injects them
# into the session context via hookSpecificOutput.additionalContext.
# Used by SessionStart and SubagentStart hooks.
#
# The split between eager and reference rules is documented in
# rules/eager/00-bootstrap.md (or the equivalent README). Reference bodies
# under rules/reference/ are installed alongside but loaded only when the
# eager breadcrumb points to them.
set -euo pipefail

INPUT=$(cat 2>/dev/null || true)
if [ -n "$INPUT" ]; then
  HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "SessionStart"' 2>/dev/null || echo "SessionStart")
else
  HOOK_EVENT="SessionStart"
fi

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RULES_DIR="$ROOT/rules/eager"

# There is deliberately NO fallback to a flat rules/ directory (#3993).
#
# It existed to cover an "older Lisa install", but a plugin's rules and this
# script ship in the same directory and install as one unit, so that skew cannot
# arise. What the branch actually did was absorb plugins that never adopted the
# split: `lisa-phaser` shipped a flat 11,007-byte rules/phaser.md on 2026-06-11,
# two weeks AFTER the split commit a820527 (2026-05-28), and the fallback
# injected the whole body at every SessionStart and SubagentStart without any
# surface reporting it. A quiet success is indistinguishable from a tree that was
# never split. With the branch gone, an unsplit plugin injects nothing and gets
# noticed. (The Codex mirror injector keeps its fallback: `.codex/lisa-rules/` is
# written separately from the script that reads it, so vintage skew IS possible
# there.)

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
jq -n --arg event "$HOOK_EVENT" --arg ctx "$CONTEXT" '{"hookSpecificOutput": {"hookEventName": $event, "additionalContext": $ctx}}'
