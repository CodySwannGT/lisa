---
description: "Plan work. Defines acceptance criteria, researches codebase, maps dependencies, and breaks down into ordered work items."
argument-hint: "<description-or-ticket-id-or-url>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Plan** flow.

**Orchestration: agent team.** Plan is a multi-specialist flow feeding a shared decomposition. After echoing the flow and orchestration mode, your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If no PRD or specification exists, suggest running the **Research** flow first to produce one.

If the argument is a JIRA ticket ID or URL, hand off to the `jira-agent` which will read the ticket and extract context.

$ARGUMENTS
