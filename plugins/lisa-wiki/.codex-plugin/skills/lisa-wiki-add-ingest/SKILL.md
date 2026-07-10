---
name: lisa-wiki-add-ingest
description: "Scaffold a project-specific…"
---

# lisa-wiki-add-ingest

Generate a thin, project-local front-door ingest skill so a project can extend ingestion **without
forking** the kernel. The front-door does only the unique part, then hands enriched parameters to
`/ingest`.

## Workflow
1. **Interview** the project: a short name; what the source is; which `wiki/sources/<sourceSystem>/`
   bucket and page type/frontmatter it should produce; whether it merely *enriches/classifies* an
   input or also *fetches* from an external system; and its **side-effect class**
   (`read-only-ingest` | `repo-write` | `external-write`).
2. **Generate** the front-door skill on both runtimes —
   `.claude/skills/lisa-wiki-local-<name>/SKILL.md` and `.agents/skills/lisa-wiki-local-<name>/SKILL.md`.
   Its body does the unique step, then **delegates to the `lisa-wiki-ingest` skill** (Claude facade
   `/ingest`) passing the bucket/type/metadata. If it fetches, it writes only a sanitized source note
   (+ run metadata) and lets the kernel do synthesis/index/log/verify/state/PR.
3. **Register** it in `wiki/lisa-wiki.config.json` under `customConnectors`
   (`{ name, skill, sourceSystem, stateFile, sideEffects }`). `/ingest` dispatches **only** to
   registered names — no auto-discovery.

## Rules (the front-door contract)
- A generated front-door writes **only** its source note + run metadata. It must not write synthesis
  pages, `index.md`, `log.md`, or final state — the kernel does those, in order, after it returns.
- `external-write` front-doors require config opt-in **and** explicit per-run intent, and their PRs
  never auto-merge.
- Side effects outside the declared class are a hard failure (enforced by the touched-file guard).

## Related
`lisa-wiki-ingest` (what it chains into), `lisa-wiki-add-role`, `lisa-wiki-doctor`.
