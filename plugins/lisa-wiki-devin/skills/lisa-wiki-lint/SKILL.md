---
name: lisa-wiki-lint
description: Health-check the LLM Wiki. Reports orphan pages, contradictions, stale claims, broken internal links, missing index/log coverage, structure-manifest violations, and secret/tenant leaks. Use periodically or before hardening a wiki. Read-only — it reports findings, it does not fix them.
---

# lisa-wiki-lint

Run the wiki's integrity checks and report findings by severity. Lint is **read-only**: it diagnoses,
it does not repair (use `/ingest`, `/setup`, or `/migrate` to fix).

## What it checks (deterministic core via `scripts/lint-wiki.mjs`)
- **Frontmatter** present/valid where required (per `schema/page-frontmatter.schema.json`).
- **Index coverage**: every page appears in `wiki/index.md`; no index rows point at missing pages.
- **Log coverage**: material changes have `wiki/log.md` entries.
- **Links**: no broken internal links; no orphan pages (unreferenced and unlinked).
- **State ordering**: no state cursor advanced without its source notes + synthesis + index + log.
- **Structure**: files conform to `schema/wiki-structure.schema.json` (canonical locations).
- **Safety**: secret patterns, tenant/contamination terms, stray binaries, child-repo contents
  staged in wrapper mode.

## What it checks (LLM-assisted)
- **Contradictions** between claims; **stale** claims (older than the configured staleness window);
  **coverage gaps** vs the wiki's stated `purpose`.

## Output
A report grouped by severity, with each item marked `PASS | WARN | FAIL`. During phased migration,
legacy issues are reported as `WARN`; in hard-enforcement mode structural/integrity issues are `FAIL`.
Read-only: lint prints the report and does not modify the wiki (it does not write a `LINT` log entry).

## Related
`lisa-wiki-doctor` (broader post-migration verification that runs lint among other checks),
`lisa-wiki-ingest`, `lisa-wiki-setup`.
