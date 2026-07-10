---
name: lisa-wiki-status
description: "Report Lisa wiki source…"
allowed-tools: ["Bash", "Read"]
---

# lisa-wiki-status

Render the Lisa wiki source freshness report without changing the repository.

## Scope

This skill answers a narrower question than `lisa-wiki-doctor` or `lisa-wiki-lint`: whether each enabled, non-external-write ingestion connector has current source evidence and what the operator should do next.

Read these repository files as the source of truth:

- `wiki/lisa-wiki.config.json` for enabled connectors and wiki root.
- `wiki/log.md` for latest ingest, skip, and blocker notes.
- `wiki/sources/**` for reader-safe source notes.
- `wiki/state/**` for connector state cursors and source-note references.

## Workflow

1. Resolve the wiki root from `wiki/lisa-wiki.config.json`, unless `--wiki` or `--config` is passed.
2. Run the bundled deterministic renderer:

   ```bash
   node plugins/lisa-wiki/scripts/wiki-status.mjs $ARGUMENTS
   ```

   If running from the source plugin tree before distribution, use `plugins/src/wiki/scripts/wiki-status.mjs`.
3. Report the rendered connector table. Preserve connector verdicts exactly:
   `fresh`, `stale`, `never_ingested`, `skipped`, or `blocked`.
4. Include the evidence paths, last observed date, skip/blocker reason when present, and exact next action for each non-fresh connector.
5. Mention `lisa-wiki-lint` only as a separate integrity follow-up. Do not conflate freshness with broken links, stale claims, or structure linting.

## Rules

- **Read-only.** Do not ingest, edit wiki pages, edit config, advance state, branch, commit, push, open PRs, or run repair flows.
- Do **not** ask for confirmation before rendering. This status command has no write side effects.
- Do **not** use global Codex memory or non-project memory as fresh wiki evidence. Only project-scoped source notes, state, and log entries count.
- If the wiki/config is missing, surface the renderer output or error directly and stop.
- If a connector is skipped because project-scoped memory is unavailable, preserve that reason and treat accepting the expected skip as a valid next action.

## Related

`lisa-wiki-ingest` refreshes sources, `lisa-wiki-lint` checks wiki integrity, and `lisa-wiki-doctor` verifies setup/readiness.
