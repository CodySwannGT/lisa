---
description: "Vendor-agnostic batch scanner for Ready queues. Notion PRD database URL → finds Status=Ready PRDs and runs lisa:plan per item. Confluence space or parent-page URL → finds prd-ready PRDs and runs lisa:plan per item. Linear workspace or team URL → finds prd-ready Linear projects and runs lisa:plan per item. GitHub repo URL or org/repo token → finds prd-ready GitHub issues and runs lisa:plan per item (PRD-source mode), or finds status:ready issues and runs lisa:implement per item when tracker=github (build-queue mode). JIRA project key or JQL → finds Ready tickets and runs lisa:implement per item. Designed as the cron target for /schedule."
argument-hint: "<Notion-PRD-database-URL | Confluence-space-URL | Confluence-parent-page-URL | Linear-workspace-URL | Linear-team-URL | GitHub-repo-URL | org/repo | JIRA-project-key | JQL-filter>"
---

Use the /lisa:intake skill to scan the queue for Ready items and dispatch each one through the appropriate single-item lifecycle skill. $ARGUMENTS
