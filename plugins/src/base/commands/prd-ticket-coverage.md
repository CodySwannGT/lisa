---
description: "Audit PRD-to-tickets coverage. Verifies every requirement in a Notion PRD is covered by at least one created JIRA ticket; flags gaps (silent drops) and scope creep. Read-only — no writes to JIRA or Notion."
allowed-tools: ["Skill"]
argument-hint: "<PRD URL> [tickets=KEY-1,KEY-2,...]"
---

Use the /lisa:prd-ticket-coverage skill to audit coverage of the PRD against the listed (or auto-discovered) JIRA tickets and produce a coverage matrix + verdict. $ARGUMENTS
