---
name: lisa-wiki-query
description: "Answer a question from the LLM…"
---

# lisa-wiki-query

Answer from the wiki, with citations, without changing it (by default).

## Workflow
0. **Resolve the wiki root.** Run `node scripts/ensure-wiki.mjs --json` and use the returned
   `wikiRoot` as the base for every read below — never assume `wiki/`. A local wiki resolves
   instantly (no-op); a wiki whose `.lisa.config.json` declares `wiki.source.url` is mirrored and
   refreshed transparently first. The script is offline-tolerant (it proceeds with the existing
   mirror and warns rather than blocking), so freshness is guaranteed here and the caller never has
   to think about it.
1. Read `<wikiRoot>/index.md` to locate candidate pages; consult `<wikiRoot>/start-here.md` for orientation.
2. Drill into the relevant synthesis pages and their cited source notes.
3. Synthesize an answer. **Every claim cites its wiki page and/or source note.** If the wiki does not
   support an answer, say so plainly rather than inventing one; suggest an `/ingest` that would fill
   the gap. Only record the gap in `wiki/open-questions/` if the user explicitly asks (that is a
   writeback — see step 4); never write it silently.
4. **Writeback (opt-in only):** if — and only if — the user explicitly asks to persist new synthesis
   discovered during the query, route it through the ingest pipeline so provenance/index/log/state
   stay consistent, and log it as a `QUERY` operation. Never write back silently.

## Rules
- **Read-only by default.** No page edits, index/log changes, state advancement, or PRs unless the
  user explicitly requests writeback.
- Prefer the wiki's own content over outside knowledge; distinguish wiki-sourced facts from your own
  reasoning.
- Surface contradictions or stale claims you encounter as `/lint`-style findings rather than
  silently picking one.

## Related
`lisa-wiki-ingest`, `lisa-wiki-lint`, `lisa-wiki-usage`.
