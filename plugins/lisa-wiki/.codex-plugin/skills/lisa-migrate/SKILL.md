---
name: lisa-migrate
description: "Migrate an existing hand-rolled…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:migrate`
- Codex invocation: `$lisa-migrate` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[--phase <0|1|1b|2|3|4|5>]`

Use the lisa-wiki-migrate skill to move this repo's bespoke wiki onto the kernel in reviewable phases: inventory, adopt kernel, absorb documentation, consolidate runtime + connectors, normalize by touch, then hard-enforce — parity-checking each migrated artifact before deleting the old one, and finishing with /doctor. Use the user's surrounding request as this command's arguments.
