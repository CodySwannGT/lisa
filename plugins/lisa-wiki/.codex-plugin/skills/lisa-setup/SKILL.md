---
name: lisa-setup
description: "Scaffold, repair, verify, or…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:setup`
- Codex invocation: `$lisa-setup` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[--upgrade] [--with-ci]`

Use the lisa-wiki-setup skill to bring the wiki into conformance from wiki/lisa-wiki.config.json: validate config, ask purpose + README mode, scaffold the canonical structure, render the contract snapshot (stamping kernelVersion), seed the staff roster, then verify with /doctor. Use the user's surrounding request as this command's arguments.
