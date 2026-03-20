---
description: "Build a feature. Defines acceptance criteria, researches codebase, implements via TDD, reviews, verifies, and ships."
argument-hint: "<description-or-ticket-id-or-url>"
---

Read `.claude/rules/intent-routing.md` and execute the **Build** flow.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket, extract context, and delegate back to the Build flow.

$ARGUMENTS
