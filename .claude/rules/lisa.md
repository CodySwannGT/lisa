# Lisa-Managed Files

The following files are managed by Lisa and will be overwritten on every `lisa` run. Never edit them directly. Where a local override exists, edit that instead.

## Files with local overrides (edit the override, not the managed file)

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `eslint.config.ts` | `eslint.config.local.ts` |
| `jest.config.ts` | `jest.config.local.ts` |
| `tsconfig.json` | `tsconfig.local.json` |
| `eslint.ignore.config.json` | `eslint.config.local.ts` |

## Create-only files (edit freely, Lisa won't overwrite)

- `.claude/rules/PROJECT_RULES.md`
- `eslint.thresholds.json`
- `jest.thresholds.json`

## Files and directories with NO local override (do not edit at all)

- `.claude/rules/coding-philosophy.md`, `.claude/rules/plan.md`, `.claude/rules/verfication.md`
- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `eslint.base.ts`, `eslint.typescript.ts`, `eslint.expo.ts`, `eslint.nestjs.ts`, `eslint.cdk.ts`, `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts`, `jest.expo.ts`, `jest.nestjs.ts`, `jest.cdk.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json`, `tsconfig.expo.json`, `tsconfig.nestjs.json`, `tsconfig.cdk.json`
- `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `eslint-plugin-code-organization/*`, `eslint-plugin-component-structure/*`, `eslint-plugin-ui-standards/*`
- `.claude/settings.json`, `.claude/hooks/*`, `.claude/skills/*` (hyphen-named, e.g. `plan-create`), `.claude/commands/*`, `.claude/agents/*`
- `.claude/README.md`, `.claude/REFERENCE.md`
- `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `.github/workflows/claude.yml`
- `.github/workflows/build.yml`, `.github/workflows/lighthouse.yml` (Expo)
- `.github/workflows/load-test.yml`, `.github/workflows/zap-baseline.yml` (NestJS)
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`, `.github/k6/*`
- `lighthouserc.js`, `.mcp.json`, `.easignore.extra` (Expo)
- `scripts/zap-baseline.sh`, `.zap/*`
- `ast-grep/*`
