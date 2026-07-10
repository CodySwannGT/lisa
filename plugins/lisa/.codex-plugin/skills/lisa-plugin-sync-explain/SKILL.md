---
name: lisa-plugin-sync-explain
description: "Read-only diagnostic for Lisa…"
allowed-tools: ["Bash", "Read"]
---

# Plugin Sync Explain: $ARGUMENTS

`/lisa:plugin-sync-explain` explains why the plugin sync gate would need attention without mutating the working tree.

## Scope

Inspect the current Lisa repository, or an optional path passed as `$ARGUMENTS`, using `scripts/plugin-sync-explain.mjs`.

The diagnostic is **read-only**:

- Do not run `bun run build:plugins`.
- Do not run `bun run check:plugins`.
- Do not edit source files, generated plugin artifacts, or `.claude-plugin/marketplace.json`.
- Do not stash, commit, reset, or clean local changes.

## What to Report

Report a concise terminal-first summary with stable classifications:

- `SOURCE_NOT_BUILT`: files under `plugins/src/**` changed without their generated `plugins/lisa*` counterpart.
- `GENERATED_ONLY`: files under `plugins/lisa*` changed without their `plugins/src/**` source counterpart.
- `MARKETPLACE_REGISTRATION_DRIFT`: a built plugin directory is missing from `.claude-plugin/marketplace.json`, or a marketplace source points at a missing built directory.
- `OUT_OF_SYNC`: source and generated counterparts both changed and need human review.
- `IN_SYNC`: no plugin source/generated or marketplace registration drift was detected.

For every finding, include the evidence path and the smallest source-first next action. Prefer `bun run build:plugins` only after source edits are in the right place, and preserve `bun run check:plugins` as the final reproducibility gate.

## Process

1. Resolve the repo path from `$ARGUMENTS` or the current directory.
2. Capture `git status --porcelain` before the diagnostic.
3. Run:
   ```bash
   node plugins/lisa/scripts/plugin-sync-explain.mjs "$REPO_PATH"
   ```
   If running from the source tree before generated artifacts are rebuilt, use:
   ```bash
   node plugins/src/base/scripts/plugin-sync-explain.mjs "$REPO_PATH"
   ```
4. Capture `git status --porcelain` after the diagnostic and confirm it is unchanged.
5. Surface the script output plus the read-only confirmation.

## Rules

- Keep this surface aligned with `scripts/check-plugins-sync.sh`; it explains the gate but does not replace it.
- Treat `plugins/src/**` as the source of truth and `plugins/lisa*` as generated artifacts.
- If the diagnostic cannot inspect git status or marketplace JSON, report the error plainly and do not guess.
