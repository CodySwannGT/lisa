# Plan: Complete Vitest Migration — CDK + Test File Codemod

## Context

The Jest→Vitest infrastructure migration (Phases 0-7) is complete for Lisa, TypeScript, and NestJS stacks. 10 of 13 downstream PRs are merged. Three remaining gaps:

1. **CDK/infrastructure projects** — were initially excluded but should migrate to Vitest (CDK tests use Template assertions, not jest.fn/mock, so migration is clean)
2. **ask-gemini** — merged with Jest preserved, needs test file transformation (48 files, 5 with `jest.isolateModules`)
3. **NestJS backends** (propswap/backend, geminisportsai/backend-v2, thumbwar/backend) — PRs open with vitest config but test files still use Jest APIs via compat shim

**Goal:** After this work, only Expo projects should have Jest. All TypeScript, NestJS, CDK, and npm-package projects use Vitest.

---

## Part A: CDK Vitest Config Factory + Templates

### A1. Create `src/configs/vitest/cdk.ts`

Factory: `getCdkVitestConfig(options)` based on `src/configs/jest/cdk.ts`:

```typescript
{
  test: {
    globals: true,
    environment: "node",
    root: "test",
    include: ["**/*.test.ts", "**/*.spec.ts", "**/*.integration-test.ts", "**/*.integration-spec.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "util/**/*.ts"],
      exclude: [...defaultCoverageExclusions],
      thresholds: { /* mapped */ },
    },
  },
}
```

### A2. Update exports

- `src/configs/vitest/index.ts` — add CDK export
- `package.json` — add `"./vitest/cdk": "./dist/configs/vitest/cdk.js"`

### A3. Create tests

`tests/unit/config/vitest-cdk.test.ts`

### A4. CDK template files

**Create:**
- `cdk/copy-overwrite/vitest.config.ts` — entry point importing from `@codyswann/lisa/vitest/cdk`
- `cdk/copy-overwrite/vitest.cdk.ts` — re-exports from `@codyswann/lisa/vitest/cdk`
- `cdk/create-only/vitest.config.local.ts`
- `cdk/create-only/vitest.thresholds.json`

**Delete:**
- `cdk/copy-overwrite/jest.config.ts`
- `cdk/copy-overwrite/jest.cdk.ts`

### A5. CDK governance

**Update `cdk/deletions.json`:**
- Remove vitest file deletions (currently present from v1.65.2 fix)
- Add jest file deletions: `jest.config.ts`, `jest.config.local.ts`, `jest.cdk.ts`, `jest.thresholds.json`

**Update `cdk/package-lisa/package.lisa.json`:**
- Scripts: replace Jest commands with Vitest (`vitest run`, `vitest run --coverage`, etc.)
- DevDependencies: replace `jest`/`ts-jest`/`@types/jest`/`@jest/test-sequencer` with `vitest`/`@vitest/coverage-v8`

**Files to create:** 5 (factory, test, 2 copy-overwrite, 2 create-only)
**Files to modify:** 4 (index.ts, package.json, deletions.json, package.lisa.json)
**Files to delete:** 2 (jest.config.ts, jest.cdk.ts from cdk/copy-overwrite)

---

## Part B: Test File Codemod for Non-Expo Projects

Transform test files in downstream projects from Jest APIs to Vitest APIs.

### B1. Mechanical transformations (all projects)

Applied to: ask-gemini, propswap/backend, geminisportsai/backend-v2, thumbwar/backend

For every `.test.ts` and `.spec.ts` file:
- `jest.fn()` → `vi.fn()`
- `jest.mock()` → `vi.mock()`
- `jest.spyOn()` → `vi.spyOn()`
- `jest.clearAllMocks()` → `vi.clearAllMocks()`
- `jest.resetAllMocks()` → `vi.resetAllMocks()`
- `jest.restoreAllMocks()` → `vi.restoreAllMocks()`
- `jest.useFakeTimers()` → `vi.useFakeTimers()`
- `jest.advanceTimersByTime()` → `vi.advanceTimersByTime()`
- `jest.runAllTimers()` → `vi.runAllTimers()`
- `jest.Mocked<T>` → `Mocked<T>` (import from vitest)
- `jest.SpyInstance` → `MockInstance` (import from vitest)
- `jest.Mock` → `Mock` (import from vitest)
- Remove `import { ... } from "@jest/globals"` lines
- Add `import { vi } from "vitest"` where `vi.*` is used (globals:true handles describe/it/expect)

### B2. Complex patterns (ask-gemini specific)

5 files with `jest.isolateModules`:
```typescript
// Jest:
jest.isolateModules(() => {
  const mod = require("../module");
});

// Vitest:
vi.resetModules();
const mod = await import("../module");
```

3 files with `jest.requireActual`:
```typescript
// Jest:
const actual = jest.requireActual("module");

// Vitest:
const actual = await vi.importActual("module");
```

### B3. Setup files

For each NestJS project: port `jest.setup.js` → `vitest.setup.ts` with proper `vi.mock()` calls.
For ask-gemini: create `vitest.setup.ts` with AWS SDK mocks from jest.setup.js.

### B4. Remove compat shims

After test files are converted, remove the `vitest.setup.ts` jest compat shims (jest.fn = vi.fn mappings) from NestJS projects that the initial update agent created.

### B5. Restore coverage thresholds

NestJS projects had thresholds set to 0 during initial migration. Restore original values after tests pass.

### B6. Re-enable pre-push hooks

NestJS projects had test execution commented out in `.husky/pre-push`. Re-enable after tests pass.

---

## Part C: Update Downstream Projects

### CDK projects (Part A results)

After Lisa publishes CDK vitest support:
- propswap/infrastructure → main (new PR, previous one already merged with Jest)
- geminisportsai/infrastructure-v2 → main (new PR)
- qualis/infrastructure → main (new PR)
- thumbwar/infrastructure → main (update existing PR #75 or new PR)

CDK tests don't use jest.fn(), so no codemod needed — just config swap.

### TypeScript + NestJS projects (Part B codemod)

- geminisportsai/ask-gemini → dev (update existing merged code, new PR)
- propswap/backend → staging (update existing open PR #571)
- geminisportsai/backend-v2 → dev (update existing open PR #612)
- thumbwar/backend → main (update existing open PR #113)

---

## PR Sequence

1. **Lisa PR**: Part A — CDK vitest factory + templates + governance
2. **Lisa release**: wait for npm publish
3. **Downstream CDK PRs** (4 projects): update Lisa, verify tests pass, merge
4. **Downstream codemod PRs** (4 projects): transform test files, restore thresholds, merge
5. Watch CI + deploys for all

---

## Verification

After each phase:
- `bun run build && bun run test && bun run typecheck && bun run lint`
- For downstream: `bun test` locally before pushing
- Watch CI checks pass before merging
- Verify deploys succeed (except thumbwar — expected to fail)

## Sessions

| Session ID | Date | Notes |
|-----------|------|-------|
