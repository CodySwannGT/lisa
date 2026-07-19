# Project Rules

Project-specific rules and guidelines that apply to this codebase.

Rules in `.claude/rules/` are automatically loaded by Claude Code at session start.
Add project-specific patterns, conventions, and requirements below.

This file is **human-authored only** — the humans' decree surface. Automated
flows never append to it: machine-captured learnings land in the learnings
ledger (default `.lisa/PROJECT_LEARNINGS.md`) via the executable contract, and
the gardener (`/lisa:learnings:audit`) proposes promotions, demotions, and
retirements as human-gated tracker tickets. Existing sections of this file are
first-run gardener candidates like any other knowledge — expect prose that
restates what a lint or hook already enforces to earn a promote-and-delete
ticket over time, so this file shrinks instead of growing.

---
