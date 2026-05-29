---
name: lisa-wiki-connector-memory
description: Ingest the agent's PROJECT-SCOPED memory into a sanitized source note. Use only when lisa-wiki-ingest routes to the memory connector. NEVER ingests global or unrelated memory — global Codex memory and the Chronicle store are refused.
---

# lisa-wiki-connector-memory

A universal connector backed by `scripts/ingest-memory.mjs`. **Project-scoped only.**

## Resolve the memory directory (then pass it explicitly)
- **Claude**: per-project memory at `~/.claude/projects/<encoded-project-path>/memory/` — inherently
  project-scoped; always eligible.
- **Codex**: eligible ONLY if a project-scoped memory store exists (e.g. a per-project `CODEX_HOME`).
  The global `~/.codex/memories/` and the Chronicle store are **never** ingested (the script
  hard-refuses them).

## Flow
```
node "${PLUGIN_ROOT}/scripts/ingest-memory.mjs" --memory-dir <project-scoped-dir> \
  --config wiki/lisa-wiki.config.json --source-dir wiki/sources/memory \
  --state wiki/state/memory/memory.json --emit-meta wiki/state/handoff/memory-<runId>.json
```
Hand the source note + proposed cursor back to `lisa-wiki-ingest`.

## Rules
- Secrets are redacted; sensitivity is at least `internal`.
- If no project-scoped memory exists, ingest nothing rather than reaching for global memory.
- Writes only its source note + handoff meta; the kernel advances state.
