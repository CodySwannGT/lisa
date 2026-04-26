---
description: "Vendor-agnostic batch scanner for Status=Ready queues. Notion PRD database URL → finds Ready PRDs and runs lisa:plan per item. JIRA project key or JQL → finds Ready tickets and runs lisa:implement per item. Designed as the cron target for /schedule."
argument-hint: "<Notion-PRD-database-URL | JIRA-project-key | JQL-filter>"
---

Use the /lisa:intake skill to scan the queue for Status=Ready items and dispatch each one through the appropriate single-item lifecycle skill. $ARGUMENTS
