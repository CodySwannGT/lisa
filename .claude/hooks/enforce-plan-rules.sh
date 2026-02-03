#!/bin/bash
# Reinjects plan-mode rules on every prompt when Claude is in plan mode.
# Wired as a UserPromptSubmit hook in .claude/settings.json.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')

if [ "$PERMISSION_MODE" = "plan" ]; then
  PLAN_RULES="$CLAUDE_PROJECT_DIR/.claude/rules/plan.md"
  if [ -f "$PLAN_RULES" ]; then
    echo "PLAN MODE RULES (reinforced):"
    cat "$PLAN_RULES"
  fi
fi
exit 0
