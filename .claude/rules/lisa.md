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
- `.github/workflows/claude.yml`, `.github/workflows/claude-ci-auto-fix.yml`, `.github/workflows/claude-deploy-auto-fix.yml`, `.github/workflows/claude-code-review-response.yml`, `.github/workflows/claude-nightly-test-improvement.yml`, `.github/workflows/claude-nightly-test-coverage.yml`, `.github/workflows/claude-nightly-code-complexity.yml`, `.github/workflows/auto-update-pr-branches.yml` (wrappers — call `@main` reusable definitions)

## Directories with both Lisa-managed and project content

These directories contain files deployed by Lisa **and** files you create. Do not edit or delete Lisa-managed files — they will be overwritten. You **can** freely add your own. Check `.lisa-manifest` to see which specific files Lisa manages.

- `.claude/skills/` — Add your own skill directories alongside Lisa's
- `.claude/commands/` — Add your own command namespaces alongside Lisa's
- `.claude/hooks/` — Add your own hook scripts alongside Lisa's
- `.claude/agents/` — Add your own agent files alongside Lisa's
| `eslint.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `jest.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `.claude/rules/coding-philosophy.md` | `.claude/rules/PROJECT_RULES.md` |
| `.claude/rules/verfication.md` | `.claude/rules/PROJECT_RULES.md` |

## Files and directories with NO local override (do not edit at all)

- `.claude/rules/coding-philosophy.md`, `.claude/rules/verfication.md`, `.claude/rules/expo-verification.md` (Expo)
- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `.coderabbit.yml`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `eslint.base.ts`, `eslint.typescript.ts`, `eslint.expo.ts`, `eslint.nestjs.ts`, `eslint.cdk.ts`, `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts`, `jest.expo.ts`, `jest.nestjs.ts`, `jest.cdk.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json`, `tsconfig.expo.json`, `tsconfig.nestjs.json`, `tsconfig.cdk.json`
- `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `.claude/settings.json`
- `.claude/README.md`
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`, `.github/k6/*`
- `lighthouserc.js`, `.mcp.json`, `.easignore.extra` (Expo)
- `scripts/zap-baseline.sh`, `.zap/*`
- `ast-grep/*`
- `.claude/skills/jira-fix/*`, `.claude/skills/jira-implement/*`
- `.claude/skills/jira-journey/*`, `.claude/skills/jira-add-journey/*`, `.claude/skills/jira-evidence/*`
- `.claude/commands/jira/fix.md`, `.claude/commands/jira/implement.md`
- `.claude/commands/jira/journey.md`, `.claude/commands/jira/add-journey.md`, `.claude/commands/jira/evidence.md`
