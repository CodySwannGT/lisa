---
description: "Report Lisa wiki source freshness across enabled connectors. Read-only — summarizes last ingest evidence, skipped/blocker reasons, and targeted next actions without running ingestion."
argument-hint: "[--json] [--wiki <path>] [--config <path>]"
---

Use the lisa-wiki-status skill to render the wiki source freshness report from `wiki/lisa-wiki.config.json`, `wiki/log.md`, `wiki/sources/**`, and `wiki/state/**`. This is read-only and must not ingest, edit, branch, commit, push, or open PRs. $ARGUMENTS
