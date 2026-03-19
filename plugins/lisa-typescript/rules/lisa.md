# Lisa-Managed Files

The following files are managed by Lisa and will be overwritten on every `lisa` run. Never edit them directly. Where a local override exists, edit that instead.

## Files with local overrides (edit the override, not the managed file)

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `eslint.config.ts` | `eslint.config.local.ts` |
| `vitest.config.ts` | `vitest.config.local.ts` |
| `tsconfig.json` | `tsconfig.local.json` |

## Create-only files (edit freely, Lisa won't overwrite)

- `.claude/rules/PROJECT_RULES.md`
- `eslint.thresholds.json`
- `vitest.thresholds.json`

## Deep-merged by Lisa (Lisa wins conflicts, but project can add its own keys)

- `.claude/settings.json`

## Plugin-managed content (agents, skills, hooks, commands, rules)

These resources are distributed via the stack Claude Code plugin (e.g., `typescript@lisa`). Rules — including this file — are injected into each prompt automatically. Do not add these files to your project directory.

## Copy-overwrite files (do not edit — full list)

- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `.coderabbit.yml`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `.safety-net.json`, `audit.ignore.config.json`
- `eslint.base.ts`, `eslint.typescript.ts` (+ `expo`/`nestjs`/`cdk` variants), `eslint.slow.config.ts`
- `vitest.config.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json` (+ variants), `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `.github/workflows/quality.yml`, `release.yml`, `claude.yml`, and all other Claude/CI workflows
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`
- `ast-grep/rules/`, `ast-grep/utils/`, `ast-grep/rule-tests/`
