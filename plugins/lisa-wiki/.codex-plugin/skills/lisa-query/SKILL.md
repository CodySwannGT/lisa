---
name: lisa-query
description: "Answer a question from the LLM…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:query`
- Codex invocation: `$lisa-query` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<question>`

Use the lisa-wiki-query skill to answer from the wiki with citations: locate relevant pages via the index, synthesize a cited answer, and say plainly when the wiki cannot support an answer. Read-only unless the user explicitly asks to persist new synthesis. Use the user's surrounding request as this command's arguments.
