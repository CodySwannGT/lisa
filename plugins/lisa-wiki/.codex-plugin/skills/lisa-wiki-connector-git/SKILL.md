---
name: lisa-wiki-connector-git
description: "Produce sanitized…"
---

# lisa-wiki-connector-git

A universal, deterministic connector backed by `scripts/ingest-git.mjs`. It writes ONLY a source note
under `wiki/sources/git/` (or a per-project path) and emits a proposed cursor; the kernel performs
synthesis/index/log/verify/state/PR.

## Flow
1. Confirm `connectors.git` is enabled and `read-only-ingest`.
2. For the self repo (and each registered project under `projects/`), run:
   ```
   node "${PLUGIN_ROOT}/scripts/ingest-git.mjs" --repo <path> --slug <name> \
     --config wiki/lisa-wiki.config.json --source-dir wiki/sources/git \
     --state wiki/state/git/<slug>.json --emit-meta wiki/state/handoff/git-<slug>-<runId>.json
   ```
3. Hand the emitted source-note paths + proposed cursor back to `lisa-wiki-ingest`.

## Rules
- Read-only: only `git log`/`rev-parse`/`gh pr list` against the repo; never checkout/fetch/reset/pull.
- In wrapper/standalone mode, the registered child repos are read-only inputs and are never staged.
- Writes only its source note + handoff meta; the kernel advances `wiki/state/git/<slug>.json`.
