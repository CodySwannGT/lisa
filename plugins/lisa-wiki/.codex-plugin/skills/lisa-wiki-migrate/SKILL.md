---
name: lisa-wiki-migrate
description: "Migrate an existing…"
---

# lisa-wiki-migrate

Move a repo's bespoke wiki onto the kernel without breaking it or producing one giant diff. Each
phase is a reviewable change; nothing legacy is deleted until its replacement is parity-checked.

## Migration invariant — rename, never lose
Any unique command, ingest path, or role is migrated **as though created via** `/add-ingest`
(front-door skill) or `/add-role` (subagent); wiki-ingest aliases (`*-wiki-ingest`, custom `/ingest`
routers, …) are renamed to the canonical `/ingest`. **Loss of functionality or data is not
acceptable** — for each migrated artifact, run the old path and the new path and diff the output
before deleting the old one.

## Phases (per repo; one reviewable change each)
- **0 — Inventory.** Profile the repo: mode, root, categories, frontmatter coverage, log/index
  format, source dirs, state files, connectors, runtime surfaces, MCP config, scripts, PR policy.
  Write a pre/post manifest mapping every legacy page, source note, doc, command, ingest path, role.
- **1 — Adopt kernel (no content rewrite).** Add `wiki/lisa-wiki.config.json`, render the contract
  snapshot, add `wiki/state/README.md`, run validators in **warning** mode.
- **1b — Documentation absorption & structure.** `scripts/absorb-docs.mjs` moves the host repo's own
  docs (`docs/`, `specs/`, top-level docs) into `wiki/documentation/`, ingests them, and conforms to
  the structure manifest; `scripts/rewrite-refs.mjs` rewrites every internal link/citation/index
  entry (zero dangling links). Keep-in-place files stay at conventional paths. **Ask** the README
  mode (default `rich`; `stub` only on explicit choice). Wrapper mode moves only host docs, never
  child-project docs. Idempotent (source fingerprints); parity-checked.
- **2 — Runtime consolidation.** Replace duplicated local wiki skills with the plugin's; bespoke ones
  become `/add-ingest` front-doors or `/add-role` subagents. Claude commands become facades.
- **3 — Connector consolidation.** Centralize shared connectors (e.g. Slack); keep org-specific ones
  as contrib/overlay.
- **4 — Normalize by touch.** New/touched pages get frontmatter; new logs use the canonical table;
  legacy stays parseable until deliberately migrated.
- **5 — Hard enforcement.** Flip validators to hard-fail (and enable CI) once the baseline is clean.

## Finish
Run `lisa-wiki-doctor --migration`. The repo is not considered migrated until the verdict is `READY`
(or a human-approved `READY_WITH_WARNINGS`). Roll back by reverting the migration change.

## Related
`lisa-wiki-doctor`, `lisa-wiki-setup`, `lisa-wiki-add-ingest`, `lisa-wiki-add-role`.
