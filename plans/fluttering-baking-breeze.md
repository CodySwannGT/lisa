# Remove verify-completion.sh Stop Hook

## Context

The `verify-completion.sh` Stop hook blocks Claude from finishing a session unless it declares a verification level (`FULLY VERIFIED`, `PARTIALLY VERIFIED`, or `UNVERIFIED`) after code changes. The user wants this enforcement removed permanently from Lisa, affecting all downstream projects.

## Changes

### 1. Remove hook entry from source plugin.json

**File:** `plugins/src/base/.claude-plugin/plugin.json:65`

Remove the `verify-completion.sh` entry from the `Stop` array. Keep the other two Stop hooks (`notify-ntfy.sh` and the `entire` hook).

### 2. Remove hook entry from built plugin.json

**File:** `plugins/lisa/.claude-plugin/plugin.json:78-86`

Remove the `verify-completion.sh` entry from the `Stop` array. Keep the other two Stop hooks.

### 3. Delete hook script files

- `plugins/src/base/hooks/verify-completion.sh`
- `plugins/lisa/hooks/verify-completion.sh`

### 4. Remove "Layer 4" section from verfication.md (source)

**File:** `plugins/src/base/rules/verfication.md:187-195`

Remove the "Layer 4 — Completion Enforcement (Stop hook)" section. Keep Layers 1-3.

### 5. Remove "Layer 4" section from verfication.md (built)

**File:** `plugins/lisa/rules/verfication.md`

Same change as above — remove Layer 4 section.

## Files NOT changed

- `all/deletions.json` — already lists `.claude/hooks/verify-completion.sh` for cleanup from downstream projects (line 126). No change needed.
- `plugins/src/base/agents/verification-specialist.md` — the verification specialist agent and the broader verification framework remain useful without the automatic Stop hook enforcement. No change needed.
- `plugins/src/base/rules/verfication.md` (other sections) — the verification levels, workflow, and rules remain as guidance. Only the Stop hook enforcement section is removed.

## Verification

1. `bun run build:plugins` — confirm plugins build successfully
2. Confirm `verify-completion.sh` is not referenced anywhere outside `node_modules`, `.lisabak`, and `plans`:
   ```bash
   grep -r "verify-completion" --include="*.json" --include="*.sh" --include="*.md" . | grep -v node_modules | grep -v .lisabak | grep -v plans/
   ```
3. `bun run lint` — confirm no lint errors
4. `bun run test` — confirm tests pass
