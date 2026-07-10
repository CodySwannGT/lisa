---
name: lisa-onboard-me
description: "Onboard a user to the project…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:onboard-me`
- Codex invocation: `$lisa-onboard-me` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[--save-memory] [--write-audience-note]`

Use the lisa-wiki-onboard-me skill to onboard the user: briefly interview their role and goals (read-mostly, session-local by default; with --save-memory persist to project-scoped memory only — never global memory, never PII into the wiki), then summarize what the project is, show the folder map, and offer sample /query prompts tuned to their role. Use the user's surrounding request as this command's arguments.
