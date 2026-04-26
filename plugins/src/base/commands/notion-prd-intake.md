---
description: "Run one PRD intake cycle against a Notion PRD database. Finds Ready PRDs, validates each through the JIRA gate logic, then routes to Blocked (with clarifying comments) or Ticketed (with JIRA tickets created)."
allowed-tools: ["Skill"]
argument-hint: "<Notion database URL or ID>"
---

Use the /lisa:notion-prd-intake skill to scan the given Notion PRD database for Ready PRDs, dry-run-validate each, and route to Blocked or Ticketed. $ARGUMENTS
