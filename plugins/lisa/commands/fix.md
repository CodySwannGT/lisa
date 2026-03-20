---
description: "Fix a bug. Analyzes git history, reproduces, finds root cause, implements fix via TDD, verifies, and ships."
argument-hint: "<description-or-ticket-id-or-url>"
---

Read `.claude/rules/intent-routing.md` and execute the **Fix** flow.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket, extract context, and delegate back to the Fix flow.

$ARGUMENTS
