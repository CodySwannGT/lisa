---
description: "Investigate an issue. Analyzes git history, reproduces, traces execution, checks logs, and reports findings with evidence."
argument-hint: "<description-or-ticket-id-or-url>"
---

Read `.claude/rules/intent-routing.md` and execute the **Investigate** flow.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket and extract context.

$ARGUMENTS
