---
description: "Fix a bug. Reproduces, analyzes git history, finds root cause, implements fix via TDD, verifies locally, and reviews."
argument-hint: "<description-or-ticket-id-or-url>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Implement** flow with the **Fix** work type.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket, extract context, and delegate back to the Implement flow.

$ARGUMENTS
