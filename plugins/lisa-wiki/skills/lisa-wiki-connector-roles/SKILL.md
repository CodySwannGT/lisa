---
name: lisa-wiki-connector-roles
description: Ingest the wiki's own digital-staff roster (config.staff[] + wiki/staff/*) into a sanitized source note. Use only when lisa-wiki-ingest routes to the roles connector. Does not run any subagent.
---

# lisa-wiki-connector-roles

A universal, deterministic connector backed by `scripts/ingest-roles.mjs`. It captures the roster so
the wiki documents its own digital staff.

## Flow
```
node "${PLUGIN_ROOT}/scripts/ingest-roles.mjs" --config wiki/lisa-wiki.config.json \
  --wiki wiki --source-dir wiki/sources/roles \
  --state wiki/state/roles/roles.json --emit-meta wiki/state/handoff/roles-<runId>.json
```
Hand the source note + proposed cursor back to `lisa-wiki-ingest`.

## Rules
- Reads `config.staff[]` and `wiki/staff/*.md` only; never invokes/schedules the role subagents
  (that is out of scope — see lisa-wiki-add-role).
- Writes only its source note + handoff meta; the kernel advances state.
