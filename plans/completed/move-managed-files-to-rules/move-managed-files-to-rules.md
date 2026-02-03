# Move Lisa-Managed Files List from CLAUDE.md to .claude/rules/lisa.md

## Summary

Move the "LISA-MANAGED FILES" section (lines 57-93) from `all/copy-overwrite/CLAUDE.md` into a new `all/copy-overwrite/.claude/rules/lisa.md` file. This keeps CLAUDE.md clean and uses the rules system as intended.

## Branch Strategy

Current branch: `fix/expo-knip-and-tsconfig`. Push to existing branch, PR targets `main`.

## Files to Modify

1. **`all/copy-overwrite/CLAUDE.md`** — Remove lines 57-93 (the entire LISA-MANAGED FILES section)
2. **`all/copy-overwrite/.claude/rules/lisa.md`** — New file (copy-overwrite) containing the managed files content

## Implementation

### Step 1: Create `all/copy-overwrite/.claude/rules/lisa.md`

Move the full "LISA-MANAGED FILES" section into this new file with a proper heading. This file will be `copy-overwrite` by virtue of its directory location.

### Step 2: Remove the section from `all/copy-overwrite/CLAUDE.md`

Revert CLAUDE.md to its pre-section state (remove lines 57-93, leaving the file ending after `Never update CHANGELOG`).

## Verification

```bash
# New rules file exists with content
grep -c "LISA-MANAGED FILES" all/copy-overwrite/.claude/rules/lisa.md
# Expected: 1

# CLAUDE.md no longer has the section
grep -c "LISA-MANAGED FILES" all/copy-overwrite/CLAUDE.md
# Expected: 0

# Tests pass
bun run test

# Lint passes
bun run lint
```

## Skills to Use During Execution

- `/git:commit` — for committing the changes

## Task List

Create the following tasks using `TaskCreate`. Subagents should handle tasks 1 and 2 in parallel:

1. **Create `.claude/rules/lisa.md` with managed files content**
   - Create `all/copy-overwrite/.claude/rules/lisa.md` with the LISA-MANAGED FILES section
   - Verification: `grep -c "LISA-MANAGED FILES" all/copy-overwrite/.claude/rules/lisa.md` returns 1

2. **Remove managed files section from CLAUDE.md**
   - Remove lines 57-93 from `all/copy-overwrite/CLAUDE.md`
   - Verification: `grep -c "LISA-MANAGED FILES" all/copy-overwrite/CLAUDE.md` returns 0

3. **Run tests and lint**
   - Run `bun run test` and `bun run lint`
   - Verification: both exit 0

4. **Commit and push**
   - Use `/git:commit` to commit changes
   - Push to remote

5. **Update documentation**
   - No JSDoc or markdown doc changes needed — this is a file relocation only

6. **Archive the plan**
   - To be completed after all other tasks
   - Create folder `move-managed-files-to-rules` in `./plans/completed`
   - Move this plan into `./plans/completed/move-managed-files-to-rules/`
   - Read session IDs from the plan file
   - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/move-managed-files-to-rules/tasks`

## Sessions
| ab0980c7-8c62-4624-9f5a-9503534e03be | 2026-02-03T10:42:54Z | plan |
