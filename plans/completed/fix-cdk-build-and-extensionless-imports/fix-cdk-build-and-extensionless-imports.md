# Fix CDK Build Errors & Standardize Extensionless Imports Across All Stacks

**Branch:** `fix/cdk-build-and-extensionless-imports`
**PR Target:** `main`
**PR:** https://github.com/CodySwannGT/lisa/pull/152

## Problem

1. **CDK build fails** — `tsc --noEmit` type-checks ALL `.ts` files (no `include` scope), hitting ESM features in config files that are incompatible with CDK's `"module": "commonjs"`
2. **Non-standard `.ts` extension imports** — Jest/ESLint config files across all stacks use `from "./jest.base.ts"` instead of standard extensionless `from "./jest.base"`
3. **Wrong CDK prepare script** — CDK projects should not run build on `npm install`; only npm-package projects need that

## Solution

### A. Update `tsconfig.eslint.json` across all stacks — use `module: "preserve"` + `moduleResolution: "bundler"`

Config files (eslint, jest) are loaded by jiti/ts-jest/tsx at runtime — NOT compiled by `tsc`. The `tsconfig.eslint.json` is only for ESLint type-checking (with `noEmit: true`). Using `"module": "preserve"` + `"moduleResolution": "bundler"` allows extensionless imports while keeping the build tsconfig strict with NodeNext.

### B. Remove `.ts` extensions from all config file imports

Standardize on extensionless imports (TypeScript convention). All runtime loaders (jiti, ts-jest, tsx) resolve extensionless `.ts` files natively.

### C. CDK-specific: add `include` to `tsconfig.cdk.json` + override `prepare` script

Scope CDK build to application source directories. Override TypeScript's prepare script to skip build.

## Changes

### tsconfig.eslint.json — All Stacks (5 files)

Add `"module": "preserve"` and `"moduleResolution": "bundler"` to each:

| File | Current `module` | Current `moduleResolution` | Change |
|------|-----------------|---------------------------|--------|
| `typescript/copy-overwrite/tsconfig.eslint.json` | inherited (NodeNext) | inherited (NodeNext) | Add both explicitly |
| `cdk/copy-overwrite/tsconfig.eslint.json` | `"NodeNext"` | `"NodeNext"` | Change both |
| `nestjs/copy-overwrite/tsconfig.eslint.json` | inherited (NodeNext) | inherited (NodeNext) | Add both explicitly |
| `expo/copy-overwrite/tsconfig.eslint.json` | inherited (NodeNext) | inherited (NodeNext) | Add both explicitly |
| `tsconfig.eslint.json` (Lisa root) | inherited (NodeNext) | inherited (NodeNext) | Add both explicitly |

Example (typescript stack):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "module": "preserve",
    "moduleResolution": "bundler"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "build"]
}
```

### Remove `.ts` extensions — Jest configs (10 files)

| File | Imports to fix |
|------|---------------|
| `typescript/copy-overwrite/jest.config.ts` | `./jest.base.ts` → `./jest.base`, `./jest.typescript.ts` → `./jest.typescript`, `./jest.config.local.ts` → `./jest.config.local` |
| `typescript/copy-overwrite/jest.typescript.ts` | `./jest.base.ts` → `./jest.base` |
| `cdk/copy-overwrite/jest.config.ts` | `./jest.base.ts` → `./jest.base`, `./jest.cdk.ts` → `./jest.cdk`, `./jest.config.local.ts` → `./jest.config.local` |
| `cdk/copy-overwrite/jest.cdk.ts` | `./jest.base.ts` → `./jest.base` |
| `nestjs/copy-overwrite/jest.config.ts` | `./jest.base.ts` → `./jest.base`, `./jest.nestjs.ts` → `./jest.nestjs`, `./jest.config.local.ts` → `./jest.config.local` |
| `nestjs/copy-overwrite/jest.nestjs.ts` | `./jest.base.ts` → `./jest.base` |
| `expo/copy-overwrite/jest.config.ts` | `./jest.base.ts` → `./jest.base`, `./jest.expo.ts` → `./jest.expo`, `./jest.config.local.ts` → `./jest.config.local` |
| `expo/copy-overwrite/jest.expo.ts` | `./jest.base.ts` → `./jest.base` |
| `jest.config.ts` (Lisa root) | `./jest.base.ts` → `./jest.base`, `./jest.typescript.ts` → `./jest.typescript`, `./jest.config.local.ts` → `./jest.config.local` |
| `jest.typescript.ts` (Lisa root) | `./jest.base.ts` → `./jest.base` |

### Remove `.ts` extensions — ESLint configs (2 files)

| File | Import to fix |
|------|--------------|
| `typescript/copy-overwrite/eslint.config.ts` | `./eslint.config.local.ts` → `./eslint.config.local` |
| `eslint.config.ts` (Lisa root) | `./eslint.config.local.ts` → `./eslint.config.local` |

### CDK tsconfig.cdk.json — Add `include` (1 file)

`cdk/copy-overwrite/tsconfig.cdk.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "sourceMap": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["lib/**/*", "bin/**/*", "test/**/*"]
}
```

Projects with non-standard directories override via `tsconfig.local.json` (create-only).

### CDK package.lisa.json — Add prepare (1 file)

`cdk/package-lisa/package.lisa.json` — add `"prepare"` to `force.scripts`:
```json
"prepare": "husky install || true"
```

## File Summary

| # | File | Change |
|---|------|--------|
| 1 | `typescript/copy-overwrite/tsconfig.eslint.json` | Add module/moduleResolution |
| 2 | `cdk/copy-overwrite/tsconfig.eslint.json` | Change module/moduleResolution |
| 3 | `nestjs/copy-overwrite/tsconfig.eslint.json` | Add module/moduleResolution |
| 4 | `expo/copy-overwrite/tsconfig.eslint.json` | Add module/moduleResolution |
| 5 | `tsconfig.eslint.json` (Lisa root) | Add module/moduleResolution |
| 6 | `typescript/copy-overwrite/jest.config.ts` | Remove `.ts` from 3 imports |
| 7 | `typescript/copy-overwrite/jest.typescript.ts` | Remove `.ts` from 1 import |
| 8 | `cdk/copy-overwrite/jest.config.ts` | Remove `.ts` from 3 imports |
| 9 | `cdk/copy-overwrite/jest.cdk.ts` | Remove `.ts` from 1 import |
| 10 | `nestjs/copy-overwrite/jest.config.ts` | Remove `.ts` from 3 imports |
| 11 | `nestjs/copy-overwrite/jest.nestjs.ts` | Remove `.ts` from 1 import |
| 12 | `expo/copy-overwrite/jest.config.ts` | Remove `.ts` from 3 imports |
| 13 | `expo/copy-overwrite/jest.expo.ts` | Remove `.ts` from 1 import |
| 14 | `jest.config.ts` (Lisa root) | Remove `.ts` from 3 imports |
| 15 | `jest.typescript.ts` (Lisa root) | Remove `.ts` from 1 import |
| 16 | `typescript/copy-overwrite/eslint.config.ts` | Remove `.ts` from 1 import |
| 17 | `eslint.config.ts` (Lisa root) | Remove `.ts` from 1 import |
| 18 | `cdk/copy-overwrite/tsconfig.cdk.json` | Add `include` array |
| 19 | `cdk/package-lisa/package.lisa.json` | Add `prepare` script |

**19 files total**

## Reusable Patterns

- `include` scoping mirrors `tsconfig.typescript.json:11` (`"include": ["src/**/*"]`)
- Extensionless imports match existing ESLint configs (e.g., CDK `eslint.config.ts:25`: `from "./eslint.cdk"`)
- `module: "preserve"` + `moduleResolution: "bundler"` is the recommended TS 5.4+ pattern for type-check-only configs
- CDK prepare override follows same pattern as `npm-package/package-lisa/package.lisa.json:5`

## Skills

- `/coding-philosophy` — during implementation
- `/jsdoc-best-practices` — update JSDoc preamble references to `.ts` filenames
- `/git:commit` — atomic conventional commits
- `/git:submit-pr` — open draft PR

## Verification

1. **Lisa tests pass:**
   ```bash
   bun run test
   ```

2. **Lisa typecheck passes:**
   ```bash
   bun run typecheck
   ```

3. **Lisa lint passes:**
   ```bash
   bun run lint
   ```

4. **Lisa Jest still runs (config files load correctly):**
   ```bash
   bun run test -- --listTests
   ```

5. **Run Lisa against Qualis infrastructure (CDK project):**
   ```bash
   cd /Users/cody/workspace/qualis/infrastructure && npx @codyswann/lisa@local .
   ```

6. **Qualis build passes:**
   ```bash
   cd /Users/cody/workspace/qualis/infrastructure && npm run build
   ```

7. **Qualis npm install prepare step works:**
   ```bash
   cd /Users/cody/workspace/qualis/infrastructure && npm install
   ```
   Expected: prepare runs `husky install || true`

8. **Qualis ESLint works:**
   ```bash
   cd /Users/cody/workspace/qualis/infrastructure && npm run lint
   ```

## Task List

Create these tasks using `TaskCreate`. Tasks 1-3 can run in parallel (independent changes). Task 4 depends on all of 1-3.

### Task 1: Update tsconfig.eslint.json across all stacks
**Type:** Task
**Description:** Add `"module": "preserve"` and `"moduleResolution": "bundler"` to all 5 tsconfig.eslint.json files (typescript, cdk, nestjs, expo stacks + Lisa root). This enables extensionless imports during ESLint type-checking. For CDK, change existing `"NodeNext"` values; for others, add the settings explicitly to override inherited NodeNext.
**Files:** `typescript/copy-overwrite/tsconfig.eslint.json`, `cdk/copy-overwrite/tsconfig.eslint.json`, `nestjs/copy-overwrite/tsconfig.eslint.json`, `expo/copy-overwrite/tsconfig.eslint.json`, `tsconfig.eslint.json` (root)
**Skills:** `/coding-philosophy`
**Verification:** `bun run typecheck` passes

### Task 2: Remove `.ts` extensions from all config file imports
**Type:** Task
**Description:** Remove `.ts` extensions from all jest and eslint config file imports across all stacks (12 template files + 4 Lisa root files = 16 files total). Change `from "./jest.base.ts"` → `from "./jest.base"` etc. See plan for complete file list.
**Files:** See plan "Remove `.ts` extensions" sections
**Skills:** `/coding-philosophy`
**Verification:** `bun run lint` passes AND `bun run test -- --listTests` succeeds (config files still load)

### Task 3: CDK tsconfig.cdk.json — add `include` + package.lisa.json prepare
**Type:** Task
**Description:** Add `"include": ["lib/**/*", "bin/**/*", "test/**/*"]` to `cdk/copy-overwrite/tsconfig.cdk.json`. Add `"prepare": "husky install || true"` to `cdk/package-lisa/package.lisa.json` force.scripts.
**Files:** `cdk/copy-overwrite/tsconfig.cdk.json`, `cdk/package-lisa/package.lisa.json`
**Skills:** `/coding-philosophy`
**Verification:** `jq '.force.scripts.prepare' cdk/package-lisa/package.lisa.json` outputs `"husky install || true"` AND `jq '.include' cdk/copy-overwrite/tsconfig.cdk.json` outputs the array

### Task 4: Integration test against Qualis infrastructure
**Type:** Task (blocked by Tasks 1-3)
**Description:** Run Lisa locally against `/Users/cody/workspace/qualis/infrastructure`. Verify `npm run build` passes, `npm install` prepare step runs `husky install || true`, and `npm run lint` works.
**Skills:** `/coding-philosophy`, `/lisa:integration-test`
**Verification:** All three commands exit 0

### Task 5: Run CodeRabbit code review
**Type:** Task (after Tasks 1-4)
**Description:** Review changes with `/coderabbit:review`
**Verification:** Review completes

### Task 6: Run local code review
**Type:** Task (after Tasks 1-4)
**Description:** Review changes with `/plan-local-code-review`
**Verification:** Review completes

### Task 7: Implement valid review suggestions
**Type:** Task (after Tasks 5-6)
**Description:** Address actionable feedback from CodeRabbit and local code review
**Verification:** Re-run reviews show no new critical issues

### Task 8: Simplify implemented code
**Type:** Task (after Task 7)
**Description:** Run code simplifier agent on changes
**Verification:** Agent completes

### Task 9: Update tests
**Type:** Task (after Task 7)
**Description:** Check if any existing tests reference config file imports with `.ts` extensions or tsconfig.eslint.json content. Update if found. No CDK template tests were found, so likely N/A.
**Verification:** `bun run test` passes

### Task 10: Update documentation
**Type:** Task (after Task 7)
**Description:** Update JSDoc preamble comments in jest.*.ts files that reference `"jest.base.ts"` in inheritance chain descriptions (change to `"jest.base"`). Check README for CDK prepare script references.
**Skills:** `/jsdoc-best-practices`
**Verification:** Preambles match actual import paths

### Task 11: Verify all task verification metadata
**Type:** Task (after Tasks 8-10)
**Description:** Re-run all verification commands from previous tasks
**Verification:** All commands produce expected output

### Task 12: Archive plan
**Type:** Task (after all other tasks)
**Description:**
- Create folder `fix-cdk-build-and-extensionless-imports` in `./plans/completed`
- Rename this plan to a name befitting the actual plan contents
- Move it into `./plans/completed/fix-cdk-build-and-extensionless-imports/`
- Read the session IDs from `./plans/completed/fix-cdk-build-and-extensionless-imports/`
- For each session ID, move the `~/.claude/tasks/<session-id>` directory to `./plans/completed/fix-cdk-build-and-extensionless-imports/tasks`
- Update any `in_progress` tasks to `completed`
- Commit and push changes to the PR

## Sessions
| 452246a1-2be5-4a6d-9464-cca681298086 | 2026-02-05T16:44:02Z | plan |
| b861e8cd-8292-47b9-9efe-2878279cad75 | 2026-02-05T16:52:16Z | implement |
| 96771a23-821d-4e75-8e75-97635b3108ce | 2026-02-05T17:40:32Z | implement |
