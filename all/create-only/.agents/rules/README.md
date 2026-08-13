# Host Rules

This directory holds **this project's** durable operating rules. One directory,
every coding agent — Claude Code, Codex, Cursor, OpenCode, Copilot, and
Antigravity (`agy`) all reach it through the Lisa-managed pointer block in
`AGENTS.md`.

## Ownership

This directory is **human-authored only** — the humans' decree surface. Lisa
never writes rule bodies into it, and never edits or deletes a file in it.

- Lisa's own rules live in its per-agent plugins and arrive by their own route.
  Do not copy them here.
- Machine-captured learnings do **not** belong here either. They land in the
  learnings ledger (`.lisa/PROJECT_LEARNINGS.md` by default) through the
  executable contract, and only the gardener (`/lisa:learnings:audit`) ever
  proposes a promotion out of it — as a human-gated tracker ticket, never a
  silent agent rewrite.
- Rules already sitting here are first-run gardener candidates like any other
  knowledge: expect prose that restates what a lint rule or hook already
  enforces to earn a promote-and-delete ticket, so this directory shrinks
  instead of growing.

## What belongs here

Short, always-relevant operating rules — the things an agent must know before it
starts work, that no lint rule or hook already enforces.

What does **not** belong here:

- Prose restating a lint rule, hook, or CI gate. Enforce it in the tool instead.
- Deep codebase or domain knowledge. That belongs in the project wiki, queried
  on demand.
- Bug reports, to-do lists, or design notes. Those belong in the tracker.

## How to add one

Create a Markdown file per topic (for example `deploys.md`, `data-migrations.md`)
with a heading and a handful of imperative rules. Keep each file short: this
directory is read in full whenever an agent consults it, so length is a real
cost paid on every consultation.

This README is a Lisa-seeded starter and is never overwritten — edit or delete
it freely once the directory has real content.
