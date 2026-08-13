# Wiki as Knowledge Source — Query It on Demand (load-bearing)

If the project has an LLM Wiki, it is the curated store of durable project knowledge: background, conventions, ownership, architecture, glossary, "how and why does X work here". Documentation rolls UP into that wiki; individual repos are not expected to carry their own prose docs beyond inline code comments.

**Do not load the wiki at session start.** It is deep knowledge, and paying for it on every session is exactly the cost the on-demand rungs of the `learnings-ladder` exist to avoid. Know it is there; go get it when you actually need depth.

When you do need it, call `/lisa-wiki-query`. You never have to fetch or freshness-check the wiki yourself — the query and ingest skills resolve the wiki root and guarantee it is current (`scripts/ensure-wiki.mjs`) as their own first step: a local wiki resolves instantly, a remote wiki is mirrored and refreshed transparently. Prefer what the wiki says over re-deriving it from raw sources, and fall back to code, tickets, and history when it is silent, ambiguous, or contradicted by what you observe.

If the wiki is wrong, stale, or missing knowledge that belongs there, capture the correction via `/lisa-wiki-ingest` rather than leaving it in this session. The wiki documents knowledge; it does NOT override executable behavior — when wiki and running code disagree about what the system does, trust the code.

**Applicability.** This rule applies only when the `lisa-wiki` plugin is installed, which is gated on `wiki/lisa-wiki.config.json` existing or `.lisa.config.json` declaring a `wiki` key. Without that, the query skill is not present and this rule does not apply — run `/lisa-wiki-install` (shipped in base) to enable the wiki. Never treat the absent skill as a blocker.

Full prose: [reference/wiki-knowledge-source.md](../reference/wiki-knowledge-source.md).
