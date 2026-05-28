---
description: "Explain plugin source/generated drift and marketplace registration gaps without modifying the working tree."
argument-hint: "[path]"
---

Use the /lisa:plugin-sync-explain skill to inspect plugin source/generated synchronization for the current Lisa repo. $ARGUMENTS

This command is read-only. It reports source-not-built edits, generated-only edits, marketplace registration drift, and the next source-first remediation step before an operator runs `bun run build:plugins` or `bun run check:plugins`.
