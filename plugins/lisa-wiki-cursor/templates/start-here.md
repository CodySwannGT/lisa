# Start here — {{displayName}}

## Purpose
{{purpose}}

## What this is
A git-native LLM Wiki owned by **{{org}}** and maintained by the `lisa-wiki` kernel. It is the
durable home for this project's knowledge (and documentation). Raw sources are preserved under
`wiki/sources/`; distilled knowledge lives in the category pages; the rules are in
`wiki/schema/llm-wiki-contract.md`.

## How to use it
- **Find/answer something:** `/query "<question>"` — cited answers from the wiki.
- **Add knowledge:** `/ingest <url|file|prompt>` (Codex: `$lisa-wiki-ingest`), or `/ingest` with no
  argument for a full ingest across all enabled non-external-write sources (external-write sources
  require explicit intent).
- **Browse:** [index.md](index.md).
- **Check health:** `/lint`.

## Related repositories
Other repositories this product is built from, as plain pointers. Each owns its own wiki at `wiki/`;
follow a pointer when you need something only that repository knows.

<!-- One line each: - [org/repo](https://github.com/org/repo) — what it owns. Leave empty when there are none. -->

## Map
Synthesis categories: {{categories}}.
Sources: `wiki/sources/` · State: `wiki/state/` · Contract:
`wiki/schema/llm-wiki-contract.md` · Log: `wiki/log.md`.
