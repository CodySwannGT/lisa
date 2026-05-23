# Start here — {{displayName}}

## Purpose
{{purpose}}

## What this is
A git-native LLM Wiki owned by **{{org}}** and maintained by the `lisa-wiki` kernel. It is the
durable home for this project's knowledge (and documentation). Raw sources are preserved under
`{{wikiRoot}}/sources/`; distilled knowledge lives in the category pages; the rules are in
`{{wikiRoot}}/schema/llm-wiki-contract.md`.

## How to use it
- **New here?** Run `/onboard-me` (Codex: `$lisa-wiki-onboard-me`) for a guided tour + sample questions.
- **Find/answer something:** `/query "<question>"` — cited answers from the wiki.
- **Add knowledge:** `/ingest <url|file|prompt>` (Codex: `$lisa-wiki-ingest`), or `/ingest` with no
  argument for a full ingest across all enabled non-external-write sources (external-write sources
  require explicit intent).
- **Browse:** [index.md](index.md).
- **Check health:** `/lint`.

## Map
Synthesis categories: {{categories}}.
Sources: `{{wikiRoot}}/sources/` · State: `{{wikiRoot}}/state/` · Contract:
`{{wikiRoot}}/schema/llm-wiki-contract.md` · Log: `{{wikiRoot}}/log.md`.
