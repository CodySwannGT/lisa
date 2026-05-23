---
description: "Scaffold, repair, verify, or upgrade the project's LLM Wiki from its config. Asks the wiki's purpose and README mode, renders the contract snapshot, scaffolds the canonical folders, and seeds the staff roster. Idempotent and non-destructive."
argument-hint: "[--upgrade] [--with-ci]"
---

Use the lisa-wiki-setup skill to bring the wiki into conformance from wiki/lisa-wiki.config.json: validate config, ask purpose + README mode, scaffold the canonical structure, render the contract snapshot (stamping kernelVersion), seed the staff roster, then verify with /doctor. $ARGUMENTS
