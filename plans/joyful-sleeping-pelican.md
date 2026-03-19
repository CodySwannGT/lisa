# Plan: Migrate Jest to Vitest (TypeScript, npm-package, NestJS stacks)

## Context

Lisa currently publishes shared Jest configuration factories for all stacks. The user wants to migrate from Jest to Vitest where feasible. Research confirms Vitest is incompatible with React Native/Expo (dormant vitest-react-native, no RTLRN support), so **Expo and CDK stay on Jest**. TypeScript, npm-package, and NestJS stacks migrate to Vitest via hard cutover.

**Key decisions:**
- `globals: true` — minimize downstream migration burden
- Hard cutover — no dual-support transition period
- Build a codemod — `lisa migrate-to-vitest` command for downstream projects

Sources:
- [RTLRN Vitest compatibility discussion](https://github.com/callstack/react-native-testing-library/discussions/1142) — "endless pit of issues" (Feb 2025)
- [vitest-react-native](https://github.com/sheremet-va/vitest-react-native) — dormant since Feb 2023, no releases
- [Vitest RN discussion](https://github.com/vitest-dev/vitest/discussions/1848) — no native support

---

## Scope

| Stack | Action | Risk |
|-------|--------|------|
| TypeScript | Migrate to Vitest | LOW |
| npm-package | Migrate to Vitest (inherits from TypeScript) | LOW |
| NestJS | Migrate to Vitest | MEDIUM |
| Expo | **Stay on Jest** | N/A |
| CDK | **Stay on Jest** | N/A |

---

## Phase 0: Fix Rails detector code quality (prerequisite)

**Issue:** `src/detection/detectors/rails.ts` line 35 — missing `await` on `pathExists()`.

```typescript
// Before: works but unclear — relies on async function auto-unwrapping
return pathExists(configAppPath);

// After: explicit and clear
return await pathExists(configAppPath);
```

**Note:** This is NOT a behavioral bug — JavaScript async functions auto-unwrap returned Promises. The `mise.toml` (no dot prefix) found in geminisportsai/backend-v2 was created by the `mise` tool itself, not Lisa (Lisa deploys `.mise.toml` with dot prefix to Rails projects only). The `await` fix improves code clarity and stack traces.

**Files to modify:**
- `src/detection/detectors/rails.ts` — add `await` on line 35

---

## Phase 1: Vitest config factories in Lisa

### 1a. Create `src/configs/vitest/base.ts`

Re-export framework-agnostic utilities and add Vitest-specific merge function.

```
Exports:
- defaultThresholds (reuse from jest/base.ts — same shape)
- defaultCoverageExclusions (mapped: strip "!" prefix, split into include/exclude)
- mergeThresholds (reuse — same shape, mapped internally)
- mergeVitestConfigs(...configs: UserConfig[]): UserConfig
```

Key mapping differences from Jest:
- Jest `collectCoverageFrom: ["src/**/*.ts", "!**/*.d.ts"]` → Vitest `coverage.include` + `coverage.exclude` (separate arrays, no `!` prefix)
- Jest `coverageThreshold: { global: { statements: 70 } }` → Vitest `coverage.thresholds: { statements: 70 }` (flat, no `global` wrapper)
- `mergeVitestConfigs` operates on Vitest `UserConfig` type (deep merges `test` key)

### 1b. Create `src/configs/vitest/typescript.ts`

Factory: `getTypescriptVitestConfig(options)`

```typescript
{
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [/* mapped defaultCoverageExclusions */],
      thresholds: { /* mapped from options.thresholds */ },
    },
  },
}
```

What goes away vs Jest:
- No `ts-jest` — Vitest transforms TypeScript natively via esbuild
- No `moduleNameMapper` for `.js` extensions — Vitest resolves natively
- No `extensionsToTreatAsEsm` — Vitest is ESM-native
- No `preset` — Vitest doesn't use presets

### 1c. Create `src/configs/vitest/nestjs.ts`

Factory: `getNestjsVitestConfig(options)`

```typescript
{
  test: {
    globals: true,
    environment: "node",
    root: "src",
    include: ["**/*.spec.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["**/*.ts"],
      exclude: [/* nestjsCoverageExclusions mapped */],
      thresholds: { /* mapped */ },
    },
  },
}
```

NestJS-specific considerations:
- No `ts-jest` with `tsconfig.spec.json` — Vitest uses esbuild. Path aliases from `tsconfig.spec.json` need `vite-tsconfig-paths` plugin or `resolve.alias` config.
- `moduleFileExtensions` has no Vitest equivalent (handles all extensions by default)
- NestJS decorators work fine with esbuild (metadata emission handled by `reflect-metadata` at runtime, not at transform time)

### 1d. Create `src/configs/vitest/index.ts`

Barrel export.

### 1e. Add package.json exports

```json
"./vitest": "./dist/configs/vitest/index.js",
"./vitest/base": "./dist/configs/vitest/base.js",
"./vitest/typescript": "./dist/configs/vitest/typescript.js",
"./vitest/nestjs": "./dist/configs/vitest/nestjs.js"
```

### 1f. Add vitest as a dependency to Lisa's package.json

Need `vitest` and `@vitest/coverage-v8` in dependencies (so downstream projects get them transitively or they're forced via package.lisa.json).

### 1g. Tests

- `tests/unit/config/vitest-base.test.ts`
- `tests/unit/config/vitest-typescript.test.ts`
- `tests/unit/config/vitest-nestjs.test.ts`

Mirror existing `jest-base.test.ts` patterns — verify factory output shape, threshold merging, coverage exclusion mapping.

**Files to create:**
- `src/configs/vitest/base.ts`
- `src/configs/vitest/typescript.ts`
- `src/configs/vitest/nestjs.ts`
- `src/configs/vitest/index.ts`
- `tests/unit/config/vitest-base.test.ts`
- `tests/unit/config/vitest-typescript.test.ts`
- `tests/unit/config/vitest-nestjs.test.ts`

**Files to modify:**
- `package.json` — add exports + vitest deps

**Files to reference (reuse patterns from):**
- `src/configs/jest/base.ts` — defaultThresholds, defaultCoverageExclusions, mergeThresholds, mergeConfigs
- `src/configs/jest/typescript.ts` — getTypescriptJestConfig pattern
- `src/configs/jest/nestjs.ts` — getNestjsJestConfig pattern, nestjsCoverageExclusions
- `tests/unit/config/jest-base.test.ts` — test patterns to mirror

---

## Phase 2: Template files for downstream projects

### 2a. TypeScript stack

**New copy-overwrite files:**

`typescript/copy-overwrite/vitest.config.ts`:
```typescript
import { getTypescriptVitestConfig, mergeVitestConfigs, defaultThresholds, mergeThresholds } from "@codyswann/lisa/vitest/typescript";
import localConfig from "./vitest.config.local";
import thresholdsOverrides from "./vitest.thresholds.json" with { type: "json" };

export default mergeVitestConfigs(
  getTypescriptVitestConfig({
    thresholds: mergeThresholds(defaultThresholds, thresholdsOverrides),
  }),
  localConfig
);
```

**New create-only files:**
- `typescript/create-only/vitest.config.local.ts` — empty config stub (mirrors `jest.config.local.ts`)
- `typescript/create-only/vitest.thresholds.json` — same format as `jest.thresholds.json`

**Update `typescript/deletions.json`:**
Add to `paths`: `"jest.config.ts"`, `"jest.config.local.ts"`, `"jest.base.ts"`, `"jest.typescript.ts"`, `"jest.thresholds.json"`

**Remove old copy-overwrite:**
- Delete `typescript/copy-overwrite/jest.config.ts`

### 2b. NestJS stack

**New copy-overwrite files:**
- `nestjs/copy-overwrite/vitest.config.ts` — thin wrapper like TypeScript but imports from `@codyswann/lisa/vitest/nestjs`
- `nestjs/copy-overwrite/vitest.nestjs.ts` — NestJS-specific Vitest config (replaces `jest.nestjs.ts`)

**New create-only files:**
- `nestjs/create-only/vitest.config.local.ts`
- `nestjs/create-only/vitest.thresholds.json`

**Update `nestjs/deletions.json`:**
Add to `paths`: `"jest.config.ts"`, `"jest.nestjs.ts"`, `"jest.base.ts"`, `"jest.thresholds.json"`, `"jest.config.local.ts"`

**Remove old copy-overwrite:**
- Delete `nestjs/copy-overwrite/jest.config.ts`
- Delete `nestjs/copy-overwrite/jest.nestjs.ts`

### 2c. npm-package stack

No test template files — inherits from TypeScript stack. No changes needed.

**Files to create:**
- `typescript/copy-overwrite/vitest.config.ts`
- `typescript/create-only/vitest.config.local.ts`
- `typescript/create-only/vitest.thresholds.json`
- `nestjs/copy-overwrite/vitest.config.ts`
- `nestjs/copy-overwrite/vitest.nestjs.ts`
- `nestjs/create-only/vitest.config.local.ts`
- `nestjs/create-only/vitest.thresholds.json`

**Files to modify:**
- `typescript/deletions.json`
- `nestjs/deletions.json`

**Files to delete:**
- `typescript/copy-overwrite/jest.config.ts`
- `nestjs/copy-overwrite/jest.config.ts`
- `nestjs/copy-overwrite/jest.nestjs.ts`

---

## Phase 3: Update package.lisa.json governance files

### 3a. Move test scripts from root to stack-specific files

**Problem:** Root `package.lisa.json` currently forces Jest test scripts to ALL stacks. Since Expo/CDK stay on Jest but TypeScript/NestJS switch to Vitest, test scripts must move to per-stack files.

**Root `package.lisa.json`** — Remove from `force.scripts`:
- `test`, `test:unit`, `test:integration`, `test:cov`

**Root `package.lisa.json`** — Remove from `force.devDependencies`:
- `jest`, `ts-jest`, `@types/jest`, `@jest/test-sequencer`

**`typescript/package-lisa/package.lisa.json`** — Add to `force.scripts`:
```json
"test": "vitest run",
"test:unit": "vitest run --exclude='**/*.integration[-.]*.{test,spec}.{ts,tsx}'",
"test:integration": "vitest run --include='**/*.integration[-.]*.{test,spec}.{ts,tsx}'",
"test:cov": "vitest run --coverage",
"test:watch": "vitest"
```

**`typescript/package-lisa/package.lisa.json`** — Add to `force.devDependencies`:
```json
"vitest": "^4.1.0",
"@vitest/coverage-v8": "^4.1.0"
```

**`nestjs/package-lisa/package.lisa.json`** — Add to `force.scripts`:
Same Vitest scripts as TypeScript.

**`nestjs/package-lisa/package.lisa.json`** — Add to `force.devDependencies`:
```json
"vitest": "^4.1.0",
"@vitest/coverage-v8": "^4.1.0"
```

**Expo and CDK `package.lisa.json`** — Add Jest test scripts that were removed from root:
```json
"test": "NODE_ENV=test jest --passWithNoTests",
"test:unit": "NODE_ENV=test jest --testPathIgnorePatterns=\"\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$\" --passWithNoTests",
"test:integration": "NODE_ENV=test jest --testPathPatterns=\"\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$\" --passWithNoTests",
"test:cov": "NODE_ENV=test jest --coverage"
```

And add Jest devDeps to Expo/CDK `package.lisa.json` force sections:
```json
"jest": "^30.0.0",
"ts-jest": "^29.4.6",
"@types/jest": "^30.0.0",
"@jest/test-sequencer": "^30.2.0"
```

**Files to modify:**
- `package.lisa.json`
- `typescript/package-lisa/package.lisa.json`
- `nestjs/package-lisa/package.lisa.json`
- `expo/package-lisa/package.lisa.json`
- `cdk/package-lisa/package.lisa.json`

---

## Phase 4: Migrate Lisa's own tests to Vitest

Lisa itself is a TypeScript stack project — migrate it as proof of concept.

1. Create `vitest.config.ts` at root (using Lisa's own Vitest config factory, self-hosted)
2. Create `vitest.config.local.ts` at root (port moduleNameMapper as resolve.alias)
3. Create `vitest.thresholds.json` at root (same values as jest.thresholds.json)
4. Update all 15 test files: `import { describe, it, expect } from "@jest/globals"` → remove (globals: true makes them available)
5. For config tests that import Jest types: update to import Vitest types
6. Delete `jest.config.ts`, `jest.config.local.ts`, `jest.thresholds.json` from root
7. Update Lisa's own `package.json`:
   - Add `vitest`, `@vitest/coverage-v8` to dependencies
   - Remove `@jest/globals`, `@types/jest` (keep `jest` + `ts-jest` as they're still needed for Expo/CDK config publishing)
8. Update `knip.json` if needed

**Files to create:**
- `vitest.config.ts`
- `vitest.config.local.ts`
- `vitest.thresholds.json`

**Files to modify:**
- All 15 test files in `tests/`
- `package.json`

**Files to delete:**
- `jest.config.ts` (root)
- `jest.config.local.ts` (root)
- `jest.thresholds.json` (root)

---

## Phase 5: Build migration codemod

Create a `lisa migrate-to-vitest` CLI command that automates downstream project migration.

### What the codemod does:

1. **Replace Jest globals with Vitest globals** in test files:
   - `jest.fn()` → `vi.fn()`
   - `jest.mock()` → `vi.mock()`
   - `jest.spyOn()` → `vi.spyOn()`
   - `jest.clearAllMocks()` → `vi.clearAllMocks()`
   - `jest.resetAllMocks()` → `vi.resetAllMocks()`
   - `jest.restoreAllMocks()` → `vi.restoreAllMocks()`
   - `jest.useFakeTimers()` → `vi.useFakeTimers()`
   - `jest.advanceTimersByTime()` → `vi.advanceTimersByTime()`
   - `jest.runAllTimers()` → `vi.runAllTimers()`

2. **Replace Jest types**:
   - `jest.Mocked<T>` → `Mocked<T>` (import from `vitest`)
   - `jest.SpyInstance` → `MockInstance` (import from `vitest`)
   - `jest.Mock` → `Mock` (import from `vitest`)

3. **Update imports**:
   - Remove `import { ... } from "@jest/globals"`
   - Remove `import type { ... } from "jest"` (in test files)
   - Add `import { vi, type Mocked, type Mock } from "vitest"` only when `vi.*` or types are used
   - (describe/it/expect come from globals: true, no import needed)

4. **Update config files**:
   - Rename `jest.config.local.ts` → `vitest.config.local.ts` with format conversion
   - Rename `jest.thresholds.json` → `vitest.thresholds.json`
   - Update `import type { Config } from "jest"` → Vitest UserConfig imports

5. **Update package.json**:
   - Replace `aws-sdk-client-mock-jest` → `aws-sdk-client-mock-vitest` in devDependencies (if present)

6. **Report files needing manual review**:
   - Complex `jest.mock()` with factory functions (may need `vi.hoisted()`)
   - Dynamic mocking patterns
   - Custom jest matchers

### Implementation approach:
Use `jscodeshift` (already a Lisa dependency) for AST-based transforms. More reliable than sed for handling edge cases like `jest.Mocked<SomeService>` inside type annotations.

**Files to create:**
- `src/commands/migrate-to-vitest.ts` (or integrate into existing CLI)
- `src/codemods/jest-to-vitest.ts` (jscodeshift transform)

---

## Phase 6: CI/CD, plugins, skills, and docs updates

### 6a. Nightly test coverage workflow

`.github/workflows/reusable-claude-nightly-test-coverage.yml` hardcodes `jest.thresholds.json` in 3 places:
- Line 95: `const path = 'jest.thresholds.json';`
- Line 99: `console.log('jest.thresholds.json not found, skipping.');`
- Lines 152, 167-169: Claude prompt references `jest.thresholds.json`

**Change:** Update to detect framework — check for `vitest.thresholds.json` first, fall back to `jest.thresholds.json`. Update the Claude prompt to reference the detected file.

### 6b. GITHUB_ACTIONS.md documentation

`.github/GITHUB_ACTIONS.md` references `jest.thresholds.json` by name (lines 197, 200, 206).

**Change:** Update references to mention both `vitest.thresholds.json` (TypeScript/NestJS) and `jest.thresholds.json` (Expo/CDK).

### 6c. `.gitignore` template

`all/copy-contents/.gitignore` line 102 has `!jest.config.js` (excludes jest config from the "ignore compiled JS" pattern).

**Change:** Add `!vitest.config.js` alongside.

### 6d. `knip.json` template

Root `knip.json` has `@jest/test-sequencer` in `ignoreDependencies` (line 20).

**Change:** Add `vitest` and `@vitest/coverage-v8` to `ignoreDependencies` (they're devDeps used via config, not direct imports). Keep `@jest/test-sequencer` for Expo/CDK.

### 6e. Plugin rules — TypeScript stack

`plugins/lisa-typescript/rules/lisa.md` and `plugins/src/typescript/rules/lisa.md` reference Jest config files in the "Lisa-Managed Files" table:
- Line 10: `jest.config.ts` / `jest.config.local.ts`
- Line 17: `jest.thresholds.json`
- Line 33: `jest.base.ts`, `jest.typescript.ts`

**Change:** Update to reference Vitest equivalents (`vitest.config.ts` / `vitest.config.local.ts`, `vitest.thresholds.json`). Remove `jest.base.ts`, `jest.typescript.ts` references for TypeScript stack.

### 6f. Plugin skills — test coverage

`plugins/lisa/skills/plan-add-test-coverage/SKILL.md` and `plugins/src/base/skills/plan-add-test-coverage/SKILL.md` already reference both jest and vitest config files (line 16). No change needed.

### 6g. Lisa skills — integration test + learn

- `.claude/skills/lisa-integration-test/SKILL.md` line 85: references `jest.config.local.ts`
- `.claude/skills/lisa-learn/SKILL.md` line 291: references `jest.config.local.ts`

**Change:** Update both to reference `vitest.config.local.ts` (for TypeScript/NestJS) alongside `jest.config.local.ts` (for Expo/CDK).

### 6h. Expo plugin rules (no change)

`plugins/lisa-expo/` skills reference jest.config/jest.setup — these stay as-is since Expo remains on Jest.

### 6i. Husky hooks (no change)

`.husky/pre-push` calls script names (`test:cov`, `test:integration`), not `jest` directly. No change needed.

### 6j. quality.yml (no change)

Calls `npm test`, `npm run test:cov`, etc. No Jest-specific references. No change needed.

**Files to modify:**
- `.github/workflows/reusable-claude-nightly-test-coverage.yml`
- `.github/GITHUB_ACTIONS.md`
- `all/copy-contents/.gitignore`
- `knip.json`
- `plugins/lisa-typescript/rules/lisa.md`
- `plugins/src/typescript/rules/lisa.md`
- `plugins/lisa/skills/plan-add-test-coverage/SKILL.md` (verify — may already be fine)
- `plugins/src/base/skills/plan-add-test-coverage/SKILL.md` (verify — may already be fine)
- `.claude/skills/lisa-integration-test/SKILL.md`
- `.claude/skills/lisa-learn/SKILL.md`

---

## PR Sequence

1. **PR 1**: Phase 0 — Fix Rails detector bug + add `.mise.toml` to deletions.json (ship ASAP, independent of Vitest migration)
2. **PR 2**: Phase 1 — Vitest config factories + tests
3. **PR 3**: Phase 4 — Migrate Lisa's own tests (proof of concept, validates the factories work)
4. **PR 4**: Phase 2 + 3 + 6 — Template files + package.lisa.json governance + CI/CD + plugins/skills/docs updates (breaking change for downstream)
5. **PR 5**: Phase 5 — Migration codemod

---

## Phase 7: Dogfood — run Lisa on itself

After PRs 1-4 are merged and a new Lisa version is published:

1. Update Lisa's own `@codyswann/lisa` devDependency to the newly published version
2. Run `npx @codyswann/lisa --yes .` on the Lisa repo itself
3. Verify:
   - `vitest.config.ts` is deployed (copy-overwrite)
   - `jest.config.ts` is removed (via deletions.json)
   - `jest.base.ts`, `jest.typescript.ts` are removed
   - `.mise.toml` is NOT deployed (Rails detector bug is fixed)
   - `vitest.config.local.ts` is created (create-only, if not already present from Phase 4)
   - `vitest.thresholds.json` is created (create-only)
   - package.json scripts are updated to Vitest commands
   - package.json devDependencies swap jest → vitest
4. Run `bun test` — all tests pass under Vitest
5. Run `bun run test:cov` — coverage thresholds enforced
6. Run `bun run lint && bun run typecheck && bun run format:check`
7. Commit and push — this becomes the baseline for downstream updates

This step validates the full Lisa pipeline: config factories → template deployment → test execution.

---

## Autonomous Operation Loop

### PR Lifecycle (for every PR — Lisa and downstream)

Every PR follows this lifecycle. Do NOT move to the next step until the current step succeeds:

1. **Create PR** — `gh pr create` with clear title and summary
2. **Watch CI checks** — Poll with `gh pr checks <PR_URL> --watch` or `gh run list` until all checks complete
   - If checks fail: read the failure logs (`gh run view <RUN_ID> --log-failed`), fix the issue, push, and re-watch
   - Do NOT merge a PR with failing checks
3. **Merge PR** — `gh pr merge <PR_URL> --squash` only after all checks pass
4. **Watch deploy** (for downstream projects with deploy workflows):
   - After merge, poll `gh run list --branch <target_branch> --limit 5` to find the deploy run
   - Watch with `gh run watch <RUN_ID>` or poll `gh run view <RUN_ID>` until complete
   - If deploy fails: investigate logs, fix, create a new PR, repeat from step 1
   - **Exception:** thumbwar projects — deploy is expected to fail, log it and move on
5. **Verify deploy succeeded** — confirm the run shows `completed` with `success` conclusion

### Lisa PRs (Phases 0–7)

For each Lisa PR:
1. Create PR, watch CI, merge
2. After merge: watch the **release workflow** (`gh run list --workflow=release.yml --branch=main`)
3. Confirm the new npm version is published before proceeding to downstream updates

### Downstream project updates

After Lisa publishes a new version with the Vitest migration:

For each project in `.lisa.config.local.json`:

1. Checkout target branch, pull latest
2. Create update branch: `chore/jest-to-vitest-migration`
3. Run `bun update @codyswann/lisa` + `npx @codyswann/lisa --yes .`
4. For TypeScript/NestJS: run the codemod to transform test files
5. Run `bun install` to regenerate lockfile
6. Run `bun test` locally to verify tests pass
7. Commit, push, create PR
8. **Watch CI checks** — poll until all pass (fix and re-push if failures)
9. **Merge PR** — squash merge after checks pass
10. **Watch deploy workflow** — poll until deploy completes
11. **Verify deploy success** (thumbwar projects: expect deploy failure, log and continue)

### Project update order

**TypeScript/NestJS (full Vitest migration):**
- `propswap/backend` (NestJS) → staging
- `geminisportsai/backend-v2` (NestJS) → dev
- `thumbwar/backend` (NestJS) → main (deploy expected to fail)

**CDK (Phase 0 bug fix + governance update only, stays on Jest):**
- `propswap/infrastructure` → main
- `geminisportsai/infrastructure-v2` → main
- `thumbwar/infrastructure` → main (deploy expected to fail)
- `qualis/infrastructure` → main

**Expo (Phase 0 bug fix + governance update only, stays on Jest):**
- `propswap/frontend` → staging
- `geminisportsai/frontend-v2` → dev
- `thumbwar/frontend` → main (deploy expected to fail)

**Rails (Phase 0 bug fix only):**
- `qualis/app` → staging
- `railsstarter` → main

**Other:**
- `geminisportsai/ask-gemini` → dev

---

## Downstream project migration steps (after Lisa publishes)

1. Run `bun update @codyswann/lisa` — gets new templates + Vitest deps
2. Run `npx @codyswann/lisa .` — applies templates (vitest.config.ts replaces jest.config.ts, deps swapped)
3. Run `lisa migrate-to-vitest` — codemod transforms test files
4. Run `bun install` — install vitest, remove jest
5. Run `bun test` — verify tests pass
6. Review any files flagged for manual attention

---

## Verification

After each PR:
- `bun run build` — ensure configs compile
- `bun test` — ensure all tests pass
- `bun run lint` — no lint errors
- `bun run typecheck` — no type errors

After Phase 2 (Lisa's own tests migrated):
- `bun test` using Vitest — all 15 test files pass
- `bun run test:cov` — coverage thresholds still enforced
- `bun run test:integration` — integration tests still pass

After template changes:
- Run `/lisa:integration-test` against a TypeScript downstream project (e.g., `thumbwar/backend`)
- Run `/lisa:integration-test` against a NestJS downstream project (e.g., `propswap/backend`)
- Verify Expo projects are unaffected (e.g., `propswap/frontend` still uses Jest)

## Sessions

| Session ID | Date | Notes |
|-----------|------|-------|
