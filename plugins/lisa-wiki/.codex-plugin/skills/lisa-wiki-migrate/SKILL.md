---
name: lisa-wiki-migrate
description: "Move an existing hand-rolled…"
---
Move an existing hand-rolled wiki onto the lisa-wiki kernel without losing data or functionality, in phases. Use when adopting lisa-wiki in a repo that already has its own wiki, ingest skills, or docs.


# lisa-wiki-migrate

Move a repo's bespoke wiki onto the kernel without breaking it or producing one giant diff. Each
phase is a reviewable change; nothing legacy is deleted until its replacement is parity-checked.

## Migration invariant — rename, never lose
Any unique command or ingest path is migrated **as though created via** `/add-ingest`
(front-door skill); wiki-ingest aliases (`*-wiki-ingest`, custom `/ingest`
routers, …) are renamed to the canonical `/ingest`. **Loss of functionality or data is not
acceptable** — for each migrated artifact, run the old path and the new path and diff the output
before deleting the old one.

## Phases (per repo; one reviewable change each)
- **0 — Inventory.** Profile the repo: wiki location, categories, frontmatter coverage, log/index
  format, source dirs, state files, connectors, runtime surfaces, MCP config, scripts, PR policy.
  Write a pre/post manifest mapping every legacy page, source note, doc, command, and ingest path.
  The kernel lives at `wiki/` in this repo; a wiki kept elsewhere moves here.
- **1 — Adopt kernel (no content rewrite).** Add `wiki/lisa-wiki.config.json`, render the contract
  snapshot, add `wiki/state/README.md`, run validators in **warning** mode.
- **1b — Documentation absorption & structure.** `scripts/absorb-docs.mjs` moves the host repo's own
  docs (`docs/`, `specs/`, top-level docs) into `wiki/documentation/`, ingests them, and conforms to
  the structure manifest; `scripts/rewrite-refs.mjs` rewrites every internal link/citation/index
  entry (zero dangling links). Keep-in-place files stay at conventional paths. **Ask** the README
  mode (default `rich`; `stub` only on explicit choice). Only this repo's own docs move, never another
  repository's. Idempotent (source fingerprints); parity-checked.
- **2 — Runtime consolidation.** Replace duplicated local wiki skills with the plugin's; bespoke ones
  become `/add-ingest` front-doors. Claude commands become facades.
- **3 — Connector consolidation.** Centralize shared connectors; keep org-specific ones
  as contrib/overlay.
- **4 — Normalize by touch.** New/touched pages get frontmatter; new logs use the canonical table;
  legacy stays parseable until deliberately migrated.
- **5 — Hard enforcement.** Flip validators to hard-fail (and enable CI) once the baseline is clean.

## Finish
Run `lisa-wiki-doctor --migration`. The repo is not considered migrated until the verdict is `READY`
(or a human-approved `READY_WITH_WARNINGS`). Roll back by reverting the migration change.

## Related
`lisa-wiki-doctor`, `lisa-wiki-setup`, `lisa-wiki-add-ingest`.
