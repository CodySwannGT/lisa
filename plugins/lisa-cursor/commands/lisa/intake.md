---
description: "Run one intake cycle over a ready queue — Notion, Confluence, Linear, GitHub, or JIRA — planning the first ready PRD or building the first ready ticket. The scheduled entry point."
argument-hint: "<Notion-PRD-database-URL | Confluence-space-URL | Confluence-parent-page-URL | Linear-workspace-URL | Linear-team-URL | GitHub-repo-URL | org/repo | JIRA-project-key | JQL-filter>"
---

Use the /lisa-intake skill to scan the queue for Ready items and dispatch one eligible Ready item per invocation through the appropriate single-item lifecycle skill — and, on the PRD side, close the loop by dispatching /lisa:verify-prd for one shipped PRD per cycle (shipped → verified on pass, or re-opened to ticketed with build-ready fix tickets that auto-build and re-verify on fail — never blocked). $ARGUMENTS
