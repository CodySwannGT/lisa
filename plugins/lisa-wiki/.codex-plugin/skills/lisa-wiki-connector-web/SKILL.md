---
name: lisa-wiki-connector-web
description: "Ingest a public URL into a…"
---

# lisa-wiki-connector-web

Skill-driven connector. Fetches a public URL (WebFetch / equivalent), reduces it to a reader-safe
source note, and hands off; the kernel does synthesis/index/log/verify/state/PR.

## Flow
1. Confirm `connectors.web.enabled` and `sideEffects: read-only-ingest`.
2. Fetch the URL read-only (WebFetch). Do not follow suspicious cross-host redirects without care.
3. Write a source note under `wiki/sources/web/<YYYY-MM-DD>-<slug>.md` with frontmatter
   (`type: source`, dates, `source_system: web`, the URL) and a faithful, reader-safe summary +
   key excerpts. Redact secrets; honor `sourceRetention` (e.g. `external-pointer-only` keeps just the
   URL + minimal note).
4. Emit run metadata (the source-note path) to the handoff file; return to `lisa-wiki-ingest`.

## Rules
- Read-only; never submit forms or trigger actions on the page.
- Do not invent content not present on the page; weak/uncertain material → open-questions.
- Writes only the source note + handoff meta; the kernel advances state.
