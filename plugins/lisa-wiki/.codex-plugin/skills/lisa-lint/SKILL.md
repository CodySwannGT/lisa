---
name: lisa-lint
description: "Health-check the LLM Wiki…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:lint`
- Codex invocation: `$lisa-lint` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.

Use the lisa-wiki-lint skill to run the wiki's integrity checks and report findings by severity (PASS/WARN/FAIL). It diagnoses only — fixes go through /ingest, /setup, or /migrate. Use the user's surrounding request as this command's arguments.
