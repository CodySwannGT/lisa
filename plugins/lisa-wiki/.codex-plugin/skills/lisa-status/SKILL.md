---
name: lisa-status
description: "Report Lisa wiki source…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:status`
- Codex invocation: `$lisa-status` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[--json] [--wiki <path>] [--config <path>]`

Use the lisa-wiki-status skill to render the wiki source freshness report from `wiki/lisa-wiki.config.json`, `wiki/log.md`, `wiki/sources/**`, and `wiki/state/**`. This is read-only and must not ingest, edit, branch, commit, push, or open PRs. Use the user's surrounding request as this command's arguments.
