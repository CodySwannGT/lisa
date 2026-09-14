# Host Rules

This directory holds **this project's** durable operating rules. One directory,
every coding agent — Claude Code, Codex, Cursor, OpenCode, Copilot, and
Antigravity (`agy`) all reach it through the Lisa-managed pointer block in
`AGENTS.md`.

## Ownership

The host controls this directory. Lisa's installer never overwrites its rules.
An agent may make a specific edit an operator has requested or approved,
including simplifying or removing a rule. Honor that existing authorization;
do not send the same decision through learning capture, another ticket, or a
second approval. Preserve unrelated rules and the operator's intended meaning.

- Lisa's own rules live in its per-agent plugins and arrive by their own route.
  Do not copy them here.
- Machine-captured learnings do **not** belong here either. They land in the
  learnings ledger (`.lisa/PROJECT_LEARNINGS.md` by default) through the
  executable contract, and only the gardener (`/lisa:learnings:audit`) ever
  proposes a promotion out of it — as a human-gated tracker ticket, never a
  silent agent rewrite.
- An incidental finding is not permission to add or change a standing rule.
  Decline one-off trivia and rules whose maintenance costs exceed their value.

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

For an approved standing ruling, update the relevant topic file or create one
here using ordinary editing tools. The existing pointer in `AGENTS.md` makes it
available to all six supported agents; this directory is not Claude-specific.
If the operator explicitly named another file, honor that target and any active
runtime restrictions rather than silently moving the edit here.

This README is a Lisa-seeded starter and is never overwritten — edit or delete
it freely once the directory has real content.
