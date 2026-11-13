---
description: "Run one gardener cycle over this project's knowledge surfaces (the learnings ladder, PRD #1729): inventory ledger/rules/skills/wiki/mechanical controls, gather evidence, classify via the ladder router, and file tracker tickets — per-item PROMOTE/DEMOTE tickets, one CONFIRM/RETIRE batch ticket per run, upstream Lisa issues for upstream-scoped patterns. The run only files marker-deduped tickets: build-ready under the default humanGate.mode access-only (a change to a human-authored surface stays human-gated), human-gated under strict. Terminal states: nothing-needed | candidates-proposed | blocked."
argument-hint: "[max_candidates=10] [surface=ledger|rules|skills|wiki|all] [dry_run=true]"
---

Use the /lisa-learnings-audit skill (the gardener) to run one audit cycle: inventory the knowledge surfaces, gather per-item evidence, classify candidates through the ladder router, and emit marker-deduped tracker tickets (build-ready under the default `humanGate.mode: "access-only"`, human-gated under `"strict"`), reporting the terminal state. $ARGUMENTS
