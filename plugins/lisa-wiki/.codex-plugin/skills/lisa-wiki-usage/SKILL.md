---
name: lisa-wiki-usage
description: "Explain how to browse, query…"
---

# lisa-wiki-usage

Orient a human or agent to the project's LLM Wiki and point them at the right entry points and
canonical commands. This skill is **read-only guidance** — it never writes wiki pages, advances
state, or opens PRs.

## What the wiki is

A git-native markdown knowledge base under `wiki/`, maintained by the `lisa-wiki` plugin. It follows
the three-layer model: immutable **raw sources** (`wiki/sources/`), the LLM-owned **synthesis** layer
(category directories like `concepts/`, `entities/`, `architecture/`, …), and the **schema** that
governs it (`wiki/schema/llm-wiki-contract.md`, rendered from the project's `wiki/lisa-wiki.config.json`).

## Entry points (read these first)

1. `wiki/start-here.md` — orientation and the wiki's stated purpose.
2. `wiki/index.md` — the navigation map of every page (grouped by category).
3. `wiki/schema/llm-wiki-contract.md` — the rules this wiki follows.
4. `wiki/log.md` — the append-only history of every ingestion/maintenance operation.

## How to do things

On **Claude** these are slash commands; on **Codex** invoke the same skills from the app slash list
(e.g. `$lisa-wiki-query`).

- **Find or answer something:** `/query "<your question>"` (Codex: `$lisa-wiki-query`) — read-only by
  default; returns a cited answer drawn from the wiki. Or browse `wiki/index.md` manually.
- **Get oriented as a new user:** `/onboard-me` (Codex: `$lisa-wiki-onboard-me`) — a guided tour plus
  sample questions tuned to your role.
- **Add knowledge:** `/ingest <url|file|prompt>` (Codex: `$lisa-wiki-ingest`) for a single source, or
  `/ingest` with no argument for a full ingest across all enabled **non-external-write** sources
  (external-write sources like Slack OAuth require explicit intent). Do not hand-edit synthesis pages
  to add facts — route them through `/ingest` so provenance, the index, and the log stay consistent.
- **Check the wiki's health:** `/lint` (Codex: `$lisa-wiki-lint`) — orphans, contradictions, stale
  claims, broken links.

## Citations & trust

Every synthesized claim should cite a source note (e.g. `Source: wiki/sources/<system>/<note>.md`).
If you find an uncited or contradictory claim, that is a `/lint` finding — surface it rather than
trusting it. Weak or unverified material belongs in `wiki/open-questions/`, not stated as fact.

## Related skills

`lisa-wiki-ingest`, `lisa-wiki-query`, `lisa-wiki-lint`, `lisa-wiki-onboard-me`, `lisa-wiki-setup`.
