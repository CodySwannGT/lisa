#!/usr/bin/env bash
# Ticket sync reminder hook
# Runs on TaskUpdate to remind about updating linked tickets
# Non-blocking (exit 0) - this is a reminder, not enforcement

# Temporarily disable this hook
exit 0

PLANS_DIR="${CLAUDE_PROJECT_DIR}/plans"

# Find the active plan file (most recently modified .md in plans/)
ACTIVE_PLAN=$(find "$PLANS_DIR" -maxdepth 1 -name "*.md" -type f 2>/dev/null | head -1)

if [ -z "$ACTIVE_PLAN" ]; then
  exit 0
fi

# Check if the plan contains a ticket URL (JIRA, Linear, GitHub Issues)
if grep -qiE "(https?://.*(atlassian|jira|linear|github\.com/.*/issues))" "$ACTIVE_PLAN" 2>/dev/null; then
  echo "REMINDER: This plan is linked to a ticket. Consider running /jira:sync to update the ticket with current progress."
fi

exit 0
