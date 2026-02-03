# Plan: Add Lisa-Managed Files Section to CLAUDE.md

## Summary

Add a new section to the generated `CLAUDE.md` template (`all/copy-overwrite/CLAUDE.md`) that lists all files Lisa manages/overwrites and instructs agents to edit the local override versions instead.

## Context

Lisa uses a `copy-overwrite` strategy for managed files - these are replaced every time `lisa` runs. Agents editing these files will have their changes silently lost. Each major config file has a corresponding `create-only` local override file that is safe to customize.

Currently, CLAUDE.md tells agents "Never modify this file (CLAUDE.md) directly" but doesn't warn about other managed files.

## Approach

Add a new section titled "LISA-MANAGED FILES — DO NOT EDIT" after the existing rules in `all/copy-overwrite/CLAUDE.md`. The section will:

1. Explain that these files are overwritten by Lisa on every run
2. List all managed config files across all project types (grouped by category)
3. For files with local overrides, show the override file to edit instead
4. For files without local overrides, instruct agents to ask the human before modifying

The list lives in `all/` so it applies universally. Files from expo/nestjs/cdk that don't exist in a given project are harmless - the rule simply won't apply.

## Files to Modify

- `all/copy-overwrite/CLAUDE.md` — Add the managed files section

## Implementation

Add this section after the `Never update CHANGELOG` line (end of current rules):

```markdown
LISA-MANAGED FILES — DO NOT EDIT DIRECTLY:

The following files are managed by Lisa and will be overwritten on the next `lisa` run. Never edit them directly. Use the local override file listed next to each, or ask the human if no override exists.

Configuration files:
- `eslint.config.ts` → edit `eslint.config.local.ts` instead
- `eslint.base.ts` — managed, no local override
- `eslint.typescript.ts` — managed, no local override
- `eslint.expo.ts` — managed, no local override
- `eslint.nestjs.ts` — managed, no local override
- `eslint.cdk.ts` — managed, no local override
- `eslint.slow.config.ts` — managed, no local override
- `eslint.ignore.config.json` — managed, no local override
- `eslint.thresholds.json` — project-owned, safe to edit
- `jest.config.ts` → edit `jest.config.local.ts` instead
- `jest.base.ts` — managed, no local override
- `jest.typescript.ts` — managed, no local override
- `jest.expo.ts` — managed, no local override
- `jest.nestjs.ts` — managed, no local override
- `jest.cdk.ts` — managed, no local override
- `jest.thresholds.json` — project-owned, safe to edit
- `tsconfig.json` → edit `tsconfig.local.json` instead
- `tsconfig.base.json` — managed, no local override
- `tsconfig.typescript.json` — managed, no local override
- `tsconfig.expo.json` — managed, no local override
- `tsconfig.nestjs.json` — managed, no local override
- `tsconfig.cdk.json` — managed, no local override
- `tsconfig.eslint.json` — managed, no local override
- `tsconfig.build.json` — managed, no local override
- `tsconfig.spec.json` — managed, no local override
- `.prettierrc.json` — managed, no local override
- `.prettierignore` — managed, no local override
- `.lintstagedrc.json` — managed, no local override
- `knip.json` — managed, no local override
- `commitlint.config.cjs` — managed, no local override
- `sgconfig.yml` — managed, no local override
- `.nvmrc` — managed, no local override
- `.versionrc` — managed, no local override
- `.yamllint` — managed, no local override
- `.gitleaksignore` — managed, no local override
- `lighthouserc.js` → edit `lighthouserc-config.json` instead

Project tooling:
- `CLAUDE.md` — managed (add rules to `.claude/rules/PROJECT_RULES.md` instead)
- `HUMAN.md` — managed, no local override
- `.safety-net.json` — managed, no local override
- `.claude/settings.json` — managed, no local override
- `.claude/REFERENCE.md` — managed, no local override
- `.claude/README.md` — managed, no local override
- All files in `.claude/agents/` — managed
- All files in `.claude/hooks/` — managed
- All files in `.claude/commands/` — managed
- All files in `.claude/skills/` — managed
- All files in `.claude/rules/` except `PROJECT_RULES.md` — managed
- All files in `.husky/` — managed
- All files in `.github/workflows/` except `ci.yml` and `deploy.yml` — managed
- All files in `eslint-plugin-code-organization/` — managed
- All files in `eslint-plugin-component-structure/` — managed
- All files in `eslint-plugin-ui-standards/` — managed

Package governance:
- `package.json` — partially managed via `package.lisa.json` governance (force/defaults/merge sections)
```

## Task List

When implementing, create the following tasks using TaskCreate:

1. Add managed files section to `all/copy-overwrite/CLAUDE.md` with the content above
2. Run lint/format checks to verify the file is valid
3. Run tests to verify nothing is broken
4. Archive the plan (create `add-managed-files-to-claude-md` folder in `./plans/completed`, rename and move this plan there, move any session task directories)

## Verification

- `cat all/copy-overwrite/CLAUDE.md` — confirm the section is present
- `bun run format:check` — confirm formatting passes
- `bun run lint` — confirm linting passes
- `bun run test:unit` — confirm tests pass

## Sessions
| ebcd7940-f291-4549-96e9-edd03955cbc1 | 2026-02-03T10:12:12Z | plan |
| ab0980c7-8c62-4624-9f5a-9503534e03be | 2026-02-03T10:20:36Z | plan |
