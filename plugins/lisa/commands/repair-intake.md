---
description: "Find and fix work stuck in the intake queues: blocked items whose blockers cleared, stalled builds and reviews, items closed in label but open in the tracker, missing links and labels, and finished rollups. Scheduled and capped."
argument-hint: "<Notion-PRD-database-URL | Confluence-space-URL | Confluence-parent-page-URL | Linear-workspace-URL | Linear-team-URL | GitHub-repo-URL | org/repo | JIRA-project-key | JQL-filter> [intake_mode=prd|build|both] [stale_after=2h] [max_candidates=100] [force=true]"
---

Use the /lisa-repair-intake skill to scan the queue for stuck or half-closed items, repair GitHub PRDs whose generated top-level work is missing native child links, normalize GitHub issues missing official Lisa lifecycle labels into the configured PRD/build `ready` lane, and repair every materially actionable candidate inside `max_candidates` (default 100). The default GitHub intake_mode is both, used when the caller omits `intake_mode`. Repairs include terminal native closure of items labeled done but still open, and closing out completed rollups. $ARGUMENTS
