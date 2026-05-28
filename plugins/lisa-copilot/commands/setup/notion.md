---
description: "Set up Notion as the PRD source for this project. Walks the user through creating a workspace-scoped internal-integration token, sharing the PRD database with it, and stores the token in OS keychain. Writes `notion.workspaceId`, `notion.prdDatabaseId`, and `notion.values` into `.lisa.config.json`. Offers to set top-level `source: \"notion\"`."
allowed-tools: ["Skill"]
argument-hint: "[--database=<uuid>] [--workspace=<slug>]"
---

Use the /lisa:setup-notion skill to configure Notion as the PRD source. $ARGUMENTS
