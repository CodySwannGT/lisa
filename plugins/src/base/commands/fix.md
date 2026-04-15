---
description: "Fix a bug. Reproduces, analyzes git history, finds root cause, implements fix via TDD, verifies locally, and reviews."
argument-hint: "<description-or-ticket-id-or-url>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Implement** flow with the **Fix** work type.

**Orchestration: agent team.** Fix runs a long multi-specialist sequence with parallel review. After echoing the flow and orchestration mode, your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket, extract context, and delegate back to the Implement flow.

$ARGUMENTS
