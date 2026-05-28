# Wiki as Knowledge Source (load-bearing)

If the project has an LLM Wiki (a `wiki/` directory with `index.md`), treat it as the canonical source of durable project knowledge.

Before researching background, conventions, ownership, architecture, glossary, or "how/why does X work here":

1. **Consult the wiki first.** Start from `wiki/index.md` or use the wiki query skill (`/lisa-wiki-query`).
2. **Use what the wiki says** as the authoritative answer when it covers the question — do not re-derive it from raw sources.
3. **Fall back to primary sources** (code, tickets, commit history, external docs) only when the wiki is silent, ambiguous, or contradicted by what you observe.
4. **Surface gaps.** If the wiki is wrong, stale, or missing knowledge that belongs there, flag it — and where the workflow supports it, capture the correction via `/lisa-wiki-ingest`.

The wiki documents knowledge; it does NOT override executable behavior. When wiki and running code disagree about what the system does, trust the code and treat the wiki as out of date.

If the project has no `wiki/`, this rule does not apply.

Full prose: [reference/wiki-knowledge-source.md](../reference/wiki-knowledge-source.md).
