---
description: "Plan work. Defines acceptance criteria, researches codebase, maps dependencies, and breaks down into ordered tasks."
argument-hint: "<description-or-ticket-id-or-url>"
---

Read `.claude/rules/intent-routing.md` and execute the **Plan** flow.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket and extract context.

$ARGUMENTS
