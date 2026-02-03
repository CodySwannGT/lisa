# Plan: Sync Lisa NestJS Templates to Backend Repositories

## Summary

Run Lisa v1.15.0 against `geminisportsai/backend-v2` and `thumbwar/backend` to bring them up from v1.12.1. This mirrors the frontend sync already completed for propswap, geminisportsai, and thumbwar frontends.

## Branch Strategy

- **Lisa repo**: Already on `fix/expo-knip-and-tsconfig` with open PR #137 to `main`. Any Lisa template changes push here.
- **geminisportsai/backend-v2**: Currently on `dev` (protected). Create `chore/lisa-sync-v1.15` from `dev`. PR targets `dev`.
- **thumbwar/backend**: Currently on `main` (protected). Create `chore/lisa-sync-v1.15` from `main`. PR targets `main`.

## What Lisa Sync Will Do

The command `bun run dev <path> -y` (from Lisa repo) applies templates from `all/` → `typescript/` → `nestjs/` in order:

### Copy-Overwrite (replaced every sync)
- `jest.config.ts` — New modular entry point importing `jest.nestjs.ts`
- `jest.nestjs.ts` — NestJS-specific Jest config
- `jest.base.ts` — Shared Jest utilities
- ESLint configs (`eslint.config.ts`, `eslint.nestjs.ts`, `eslint.typescript.ts`, `eslint.base.ts`, `eslint.slow.config.ts`)
- TSConfig files (`tsconfig.json`, `tsconfig.build.json`, `tsconfig.spec.json`, `tsconfig.eslint.json`, `tsconfig.nestjs.json`)
- `.claude/` skills, hooks, rules
- GitHub workflows, K6 load test configs, ZAP security config

### Create-Only (created if missing, never overwritten)
- `jest.config.local.ts` — Project-specific Jest overrides
- `jest.thresholds.json` — Project-specific coverage thresholds
- `eslint.config.local.ts`, `eslint.thresholds.json`
- `tsconfig.local.json`
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

### Package-Lisa (package.json governance)
- Merges forced scripts (k6, deploy, docker)
- Merges forced dependencies (NestJS, Apollo, TypeORM, etc.)
- Merges default scripts (TypeORM migrations)

## Post-Sync Jest Migration

The critical manual step is migrating project-specific Jest config into the new modular structure. The old monolithic `jest.config.ts` gets overwritten; project-specific settings must move to `jest.config.local.ts` and `jest.thresholds.json`.

### geminisportsai/backend-v2

**`jest.config.local.ts`** needs (settings not covered by `jest.nestjs.ts`):
- `collectCoverageFrom` additions: `!**/database/**`, `!**/migrations/**`, `!**/console.ts`, `!**/graphql.ts`, `!**/@types/**`, `!**/test-utils/**`, `!**/data-import/**`, `!**/knowledge-sync/**`, `!**/models/**`, `!**/inputs/**`, `!**/test/fixtures/**`, `!**/test/mocks/**`, `!**/test/builders/**`, `!**/test/utils/**`, `!**/handlers/**`, `!**/config/*.config.ts`, `!**/plugins/**`, `!**/subscribers/**`, `!**/*.subscriber.ts`, `!**/directives/**`, `!**/unions/**`, `!**/sms-player-identification/**`, `!**/types/**`, `!**/constants.ts`, `!**/constants/**`, `!**/decorators/**`, `!**/*.decorator.ts`, `!**/*-example.ts`, `!**/*-sample.ts`, `!**/*.integration-spec.ts`
- `testPathIgnorePatterns`: `["/node_modules/", "/knowledge-sync/subscribers/.*\\.spec\\.ts$"]`
- `moduleNameMapper`: `{ "^@test-utils$": "<rootDir>/test-utils", "^@test-utils/(.*)$": "<rootDir>/test-utils/$1" }`
- `coverageDirectory`: `"../coverage"`

**`jest.thresholds.json`**: Default 70/70/70/70 matches — no overrides needed (use template default).

### thumbwar/backend

**`jest.config.local.ts`** needs:
- `rootDir` override: `"."` (template uses `"src"` — need to check which is correct for this project)
- `testRegex` override: `".*\\.test\\.ts$"` (template uses `.spec.ts` — this project uses `.test.ts`)
- `collectCoverageFrom`: `["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.integration.test.ts", "!src/**/main.ts"]` (adjust for rootDir difference)
- `coverageDirectory`: `"./coverage"`
- `coverageReporters`: `["text", "lcov", "clover"]`
- `moduleNameMapper`: `{ "^@/(.*)$": "<rootDir>/$1" }`

**`jest.thresholds.json`**: `{ "global": { "branches": 70, "functions": 68, "lines": 77, "statements": 77 } }`

## Post-Sync Cleanup

### thumbwar/backend — Delete legacy files
- `eslint.base.mjs` (replaced by `eslint.base.ts`)
- `eslint.config.mjs` (replaced by `eslint.config.ts`)
- `eslint.slow.config.mjs` (replaced by `eslint.slow.config.ts`)
- `eslint.thresholds.config.json` (replaced by `eslint.thresholds.json`)

### Both repos — Check for duplicates
- Remove `types:check` script from `package.json` if it duplicates `typecheck`
- Remove inline `lint-staged` from `package.json` if `.lintstagedrc.json` exists
- Verify `package.lisa.json` state is correct after sync

## Verification (both repos)

```bash
bun install
bun run typecheck
bun run test
bun run lint
bun run format:check
bun run knip
```

## Execution Order

Sequential: geminisportsai/backend-v2 first, then thumbwar/backend. The first sync may reveal issues that inform the second.

## Skills Used

- `/jsdoc-best-practices` — When writing/reviewing JSDoc in `jest.config.local.ts`
- `/git:commit` — Atomic conventional commits
- `/git:submit-pr` — Create PRs to protected branches

## Task List

Create tasks using `TaskCreate` with the following items. Subagents should handle tasks in parallel where possible.

1. **Create branch and run Lisa sync on geminisportsai/backend-v2** — `cd /Users/cody/workspace/geminisportsai/backend-v2 && git checkout -b chore/lisa-sync-v1.15 dev`, then `cd /Users/cody/workspace/lisa && bun run dev /Users/cody/workspace/geminisportsai/backend-v2 -y`
2. **Migrate geminisportsai jest config to modular structure** — Move project-specific exclusions from old `jest.config.ts` into `jest.config.local.ts`, set `jest.thresholds.json` if needed, verify coverage exclusions match original behavior
3. **Post-sync cleanup for geminisportsai/backend-v2** — Remove duplicate scripts, verify package.lisa.json, run `bun install`
4. **Verify geminisportsai/backend-v2** — Run `bun run typecheck`, `bun run test`, `bun run lint`, `bun run format:check`, `bun run knip`. Fix any failures.
5. **Commit and PR for geminisportsai/backend-v2** — Use `/git:commit` then `/git:submit-pr` targeting `dev`
6. **Create branch and run Lisa sync on thumbwar/backend** — `cd /Users/cody/workspace/thumbwar/backend && git checkout -b chore/lisa-sync-v1.15 main`, then `cd /Users/cody/workspace/lisa && bun run dev /Users/cody/workspace/thumbwar/backend -y`
7. **Migrate thumbwar jest config to modular structure** — Move project-specific settings (testRegex `.test.ts`, rootDir `.`, coverage exclusions, moduleNameMapper) into `jest.config.local.ts`, set `jest.thresholds.json` with `{ "global": { "branches": 70, "functions": 68, "lines": 77, "statements": 77 } }`
8. **Post-sync cleanup for thumbwar/backend** — Delete 4 legacy files (`eslint.base.mjs`, `eslint.config.mjs`, `eslint.slow.config.mjs`, `eslint.thresholds.config.json`), remove duplicate scripts, run `bun install`
9. **Verify thumbwar/backend** — Run `bun run typecheck`, `bun run test`, `bun run lint`, `bun run format:check`, `bun run knip`. Fix any failures.
10. **Commit and PR for thumbwar/backend** — Use `/git:commit` then `/git:submit-pr` targeting `main`
11. **Update/add/remove tests** — Verify existing tests still pass in both repos after config migration. No new tests needed (config-only changes).
12. **Update/add/remove documentation** — Update JSDoc preambles in any new `jest.config.local.ts` files. No markdown doc changes expected.
13. **Archive this plan** — Create folder `sync-nestjs-backends` in `./plans/completed/`, rename this plan to `sync-nestjs-backends.md`, move it into `./plans/completed/sync-nestjs-backends/`, read session IDs from the plan file, move `~/.claude/tasks/<session-id>` directories to `./plans/completed/sync-nestjs-backends/tasks`

Tasks 1-5 are sequential (geminisportsai). Tasks 6-10 are sequential (thumbwar). Tasks 11-12 can run in parallel after tasks 4 and 9 complete. Task 13 runs last after all others complete.

## Critical Files

- `nestjs/copy-overwrite/jest.config.ts` — Template that overwrites repos' jest configs
- `nestjs/copy-overwrite/jest.nestjs.ts` — NestJS jest config with coverage exclusions
- `typescript/copy-overwrite/jest.base.ts` — Shared jest utilities (mergeConfigs, mergeThresholds)
- `nestjs/package-lisa/package.lisa.json` — NestJS package.json governance
- `geminisportsai/backend-v2/jest.config.ts` — 99-line custom config to decompose
- `thumbwar/backend/jest.config.ts` — 41-line custom config to decompose

## Sessions
