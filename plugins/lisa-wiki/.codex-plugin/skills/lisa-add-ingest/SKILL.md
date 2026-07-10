---
name: lisa-add-ingest
description: "Scaffold a project-specific…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:add-ingest`
- Codex invocation: `$lisa-add-ingest` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<short name for the new ingest path>`

Use the lisa-wiki-add-ingest skill to generate a thin, registered front-door ingest skill: interview the project for the source type, bucket, frontmatter, and side-effect class; emit a lisa-wiki-local-<name> skill that enriches then chains into /ingest; and register it under customConnectors. Use the user's surrounding request as this command's arguments.
