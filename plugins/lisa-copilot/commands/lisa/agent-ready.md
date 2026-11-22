---
description: "Make an existing project agent-ready: build its knowledge wiki, list in wiki/gaps.md the questions only a human can answer, and re-run until no gaps remain. Run before letting automations operate the project unattended."
argument-hint: "[path]"
---

Use the /lisa-agent-ready skill to build the initial knowledge wiki through read-only, redacted ingestion of every inventoried source, persist each source's complete/partial/unavailable status, write the human-answerable gaps to wiki/gaps.md, absorb any answered gaps from a prior run, and report whether every source is complete with zero gaps or what still blocks readiness. $ARGUMENTS
