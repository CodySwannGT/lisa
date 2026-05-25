---
description: "Repair counterpart to /lisa:intake. Vendor-agnostic batch scanner that finds stuck work — items left in `blocked` or stalled in an in-progress role (build `claimed`, PRD `in_review`) — across the same queues /lisa:intake serves (Notion / Confluence / Linear / GitHub PRDs; JIRA / GitHub / Linear build issues), and attempts to repair the first materially actionable one per cycle: resumes stalled in-progress work in place, re-validates blocked PRDs, and re-dispatches blocked build items whose blockers have cleared. One actionable repair per invocation; cron-safe. Designed as a /schedule target alongside /lisa:intake."
argument-hint: "<Notion-PRD-database-URL | Confluence-space-URL | Confluence-parent-page-URL | Linear-workspace-URL | Linear-team-URL | GitHub-repo-URL | org/repo | JIRA-project-key | JQL-filter> [intake_mode=prd|build|both] [stale_after=24h] [max_candidates=100] [force=true]"
---

Use the /lisa:repair-intake skill to scan the queue for stuck items (blocked, or stalled in an in-progress role) and repair the first materially actionable one. $ARGUMENTS
