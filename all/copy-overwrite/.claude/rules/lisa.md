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

## Plugin-managed content

Agents, skills, hooks, and commands are now distributed via the stack-specific Claude Code plugin (e.g., `typescript@lisa`, `expo@lisa`, `nestjs@lisa`). These resources live in the Lisa GitHub repository and update automatically when Claude Code syncs the plugin.

You do not need to manage these files locally. To customize behavior:
- Add your own agents to `.claude/agents/` alongside plugin-provided ones
- Add your own skills to `.claude/skills/` alongside plugin-provided ones
- Add your own hook scripts to `.claude/hooks/` alongside plugin-provided ones
- Add your own command namespaces to `.claude/commands/` alongside plugin-provided ones

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `eslint.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `jest.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |

## CI/Deploy workflow pattern

New projects' `ci.yml` and `deploy.yml` reference the quality and release workflows directly from the Lisa repo:

- `ci.yml` calls `CodySwannGT/lisa/.github/workflows/quality.yml@main`
- `deploy.yml` calls `CodySwannGT/lisa/.github/workflows/release.yml@main`

This means workflow improvements in the Lisa repo are picked up automatically without running `lisa:update`.

**Existing projects** that were set up before this change will still have local references (`uses: ./.github/workflows/quality.yml`). When you run `lisa:update`, the CLI will print a migration notice with the exact one-time change to make in your `ci.yml` and `deploy.yml`. After making that change, your project will also receive automatic workflow updates.

The local copies of `quality.yml` and `release.yml` remain deployed to your project for reference but are no longer called directly by `ci.yml` or `deploy.yml` after migration.

## Files and directories with NO local override (do not edit at all)

- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `.coderabbit.yml`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `eslint.base.ts`, `eslint.typescript.ts`, `eslint.expo.ts`, `eslint.nestjs.ts`, `eslint.cdk.ts`, `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts`, `jest.expo.ts`, `jest.nestjs.ts`, `jest.cdk.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json`, `tsconfig.expo.json`, `tsconfig.nestjs.json`, `tsconfig.cdk.json`
- `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `eslint-plugin-code-organization/*`, `eslint-plugin-component-structure/*`, `eslint-plugin-ui-standards/*`
- `.claude/settings.json`
- `.claude/README.md`
- `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `.github/workflows/claude.yml`, `.github/workflows/claude-ci-auto-fix.yml`, `.github/workflows/claude-deploy-auto-fix.yml`, `.github/workflows/claude-code-review-response.yml`, `.github/workflows/claude-nightly-test-improvement.yml`, `.github/workflows/claude-nightly-test-coverage.yml`, `.github/workflows/claude-nightly-code-complexity.yml`, `.github/workflows/auto-update-pr-branches.yml`
- `.github/workflows/create-issue-on-failure.yml`, `.github/workflows/create-github-issue-on-failure.yml`, `.github/workflows/create-jira-issue-on-failure.yml`, `.github/workflows/create-sentry-issue-on-failure.yml`
- `.github/workflows/build.yml`, `.github/workflows/lighthouse.yml` (Expo)
- `.github/workflows/load-test.yml`, `.github/workflows/zap-baseline.yml` (NestJS)
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`, `.github/k6/*`
- `lighthouserc.js`, `.mcp.json`, `.easignore.extra` (Expo)
- `scripts/zap-baseline.sh`, `.zap/*`
- `ast-grep/*`
