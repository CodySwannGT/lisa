---
name: lisa-wiki-ingest
description: Ingest source material into the LLM Wiki. With an argument (URL, file path, or prompt) it ingests that one source; with no argument it runs a full ingest across every enabled non-external-write source. Routes to the right connector, then runs the ordered pipeline (source note → synthesis → index → log → verify → state → commit/PR). Use whenever new knowledge should enter the wiki.
---

# lisa-wiki-ingest

The single entry point for getting knowledge into the wiki. It is a **router**: it never reimplements
synthesis per source — it selects a connector to produce a sanitized source note, then the kernel
performs the shared, ordered pipeline.

## Modes
- **Targeted:** `/ingest <url|file|prompt>` — ingest one source. Classify the input and pick the
  matching connector.
- **Full:** `/ingest` (no argument, or "do a full ingest") — iterate **every enabled connector whose
  side-effect policy permits unattended ingest**: self + other registered projects' git/PR history,
  project-scoped memory, roles, plus read-only registered sources (notion, jira, confluence,
  quickbooks, …). `external-write` connectors (Slack OAuth, CRM writeback) are **skipped unless the
  run includes explicit external-write intent**.
- **Dry run:** `/ingest --dry-run` — list the sources a full ingest would run; perform no writes.

## The ordered pipeline (per source) — never reorder
1. **Connector** validates (tenant guard + auth), reads its state cursor (first-run vs incremental),
   fetches read-only, and writes a sanitized **source note** under `wiki/sources/<system>/` plus run
   metadata. A connector writes *only* its source note + metadata — never synthesis/index/log/state.
2. **Synthesis** (kernel): distill durable knowledge into the appropriate category pages, with
   citations back to the source note. Weak/uncertain material → `wiki/open-questions/`, never asserted.
3. **Index**: update `wiki/index.md`.
4. **Log**: append a `wiki/log.md` entry (fixed operation vocabulary).
5. **Verify**: `git diff --check`, secret/tenant/contamination scans, touched-file guard.
6. **State**: advance the connector's `wiki/state/<system>/*.json` cursor — only now, after 1–5 pass.
7. **Commit/PR**: per `config.git` policy. `external-write` runs and sensitive content never auto-merge.

## Rules
- Source-note-before-synthesis; state advanced **only** after verification.
- Project-scoped only; memory ingestion never touches global/Codex-global stores.
- Respect `sourceRetention` and `sensitivity`; do not invent facts.
- Connector execution and the connector contract are detailed in the connector skills (M2+); this
  router defines and enforces the ordering and side-effect rules above.

## Related
`lisa-wiki-add-ingest` (scaffold a custom front-door that chains here), `lisa-wiki-query`,
`lisa-wiki-lint`, `lisa-wiki-doctor`.
