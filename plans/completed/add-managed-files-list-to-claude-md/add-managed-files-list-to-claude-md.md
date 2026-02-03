# Add Lisa-Managed Files List to CLAUDE.md Template

## Summary

Add a section to the `all/copy-overwrite/CLAUDE.md` template that lists all files Lisa manages (overwrites), instructs agents not to edit them, and points to local override files where they exist. This is a static list covering all stacks (typescript, expo, nestjs, cdk) — files from other stacks that don't exist in a given project are harmless.

## Branch Strategy

Current branch: `fix/expo-knip-and-tsconfig` (no open PR). PR targets `main`.

## File to Modify

- `all/copy-overwrite/CLAUDE.md` — the sole file to edit

## Implementation

Insert a `LISA-MANAGED FILES` section after the last existing rule (`Never update CHANGELOG`, line 55) and before the trailing blank lines. The section has two parts:

### Part 1: Files with local overrides (table)

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `eslint.config.ts` | `eslint.config.local.ts` |
| `jest.config.ts` | `jest.config.local.ts` |
| `tsconfig.json` | `tsconfig.local.json` |
| `eslint.ignore.config.json` | `eslint.config.local.ts` |
| `eslint.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `jest.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `.claude/rules/coding-philosophy.md` | `.claude/rules/PROJECT_RULES.md` |
| `.claude/rules/plan.md` | `.claude/rules/PROJECT_RULES.md` |
| `.claude/rules/verfication.md` | `.claude/rules/PROJECT_RULES.md` |

### Part 2: Files/directories with NO local override (do not edit at all)

Use glob patterns for directories to keep the list compact:

- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `eslint.base.ts`, `eslint.typescript.ts`, `eslint.expo.ts`, `eslint.nestjs.ts`, `eslint.cdk.ts`, `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts`, `jest.expo.ts`, `jest.nestjs.ts`, `jest.cdk.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json`, `tsconfig.expo.json`, `tsconfig.nestjs.json`, `tsconfig.cdk.json`
- `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `eslint-plugin-code-organization/*`, `eslint-plugin-component-structure/*`, `eslint-plugin-ui-standards/*`
- `.claude/settings.json`, `.claude/hooks/*`, `.claude/skills/*`, `.claude/commands/*`, `.claude/agents/*`
- `.claude/README.md`, `.claude/REFERENCE.md`
- `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `.github/workflows/claude.yml`
- `.github/workflows/build.yml`, `.github/workflows/lighthouse.yml` (Expo)
- `.github/workflows/load-test.yml`, `.github/workflows/zap-baseline.yml` (NestJS)
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`, `.github/k6/*`
- `lighthouserc.js`, `.mcp.json`, `.easignore.extra` (Expo)
- `scripts/zap-baseline.sh`, `.zap/*`
- `ast-grep/*`

## Verification

```bash
# Verify the section was added correctly
grep -c "LISA-MANAGED FILES" all/copy-overwrite/CLAUDE.md
# Expected: 1

# Verify key entries exist
grep "eslint.config.local.ts" all/copy-overwrite/CLAUDE.md
grep "do not edit" all/copy-overwrite/CLAUDE.md

# Run tests to ensure nothing breaks
bun run test

# Run lint to confirm markdown is valid
bun run lint
```

## Skills to Use During Execution

- `/git:commit` — for committing the change
- `/jsdoc-best-practices` — if any JSDoc is written (unlikely for this change)

## Task List

Create the following tasks using `TaskCreate`. Subagents should handle as many in parallel as possible:

1. **Add Lisa-managed files section to CLAUDE.md template**
   - Edit `all/copy-overwrite/CLAUDE.md` to insert the managed files section after line 55
   - Include both tables (with overrides and without overrides)
   - Verification: `grep -c "LISA-MANAGED FILES" all/copy-overwrite/CLAUDE.md` returns 1

2. **Run tests and lint**
   - Run `bun run test` and `bun run lint` to verify nothing breaks
   - Verification: both commands exit 0

3. **Commit and push changes**
   - Use `/git:commit` to commit the CLAUDE.md template change
   - Push to the current branch

4. **Archive the plan**
   - To be completed after all other tasks are done
   - Create a folder named `add-managed-files-list-to-claude-md` in `./plans/completed`
   - Rename this plan to `add-managed-files-list-to-claude-md.md` (already named correctly)
   - Move it into `./plans/completed/add-managed-files-list-to-claude-md/`
   - Read the session IDs from `./plans/completed/add-managed-files-list-to-claude-md/`
   - For each session ID, move the `~/.claude/tasks/<session-id>` directory to `./plans/completed/add-managed-files-list-to-claude-md/tasks`

## Sessions
| ab0980c7-8c62-4624-9f5a-9503534e03be | 2026-02-03T10:25:05Z | plan |
