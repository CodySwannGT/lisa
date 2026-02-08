# Plan: Fix Jest Setup File Inheritance to Match ESLint/TSConfig Pattern

## Context

Lisa's jest setup files (`jest.setup.ts`, `jest.setup.pre.js`) are currently `create-only`, meaning Lisa creates them once and never updates them. This is inconsistent with the ESLint and TSConfig patterns where Lisa **manages the base config** (`copy-overwrite`) and projects customize via **local override files** (`create-only`).

**Current (broken) pattern:**
```
jest.setup.ts (create-only) — mixes base + project-specific mocks
jest.setup.pre.js (create-only) — mixes base + project-specific globals
jest.config.local.ts (create-only) — wires up setupFiles manually
jest.expo.ts (copy-overwrite) — setupFiles: [] (empty, intentionally)
```

**ESLint/TSConfig pattern (correct):**
```
eslint.config.ts (copy-overwrite) → imports eslint.config.local.ts (create-only)
tsconfig.json (copy-overwrite) → extends tsconfig.local.json (create-only)
```

**Desired Jest pattern:**
```
jest.setup.ts (copy-overwrite) → imports jest.setup.local.ts (create-only)
jest.setup.pre.js (copy-overwrite) → requires jest.setup.pre.local.js (create-only)
jest.expo.ts (copy-overwrite) — registers setupFiles + setupFilesAfterEnv
jest.config.local.ts (create-only) — no longer needs setupFiles
```

This enables Lisa to propagate improvements to the base jest setup (React 19 fixes, new expo-router mocks, RTLRN updates) to all downstream projects, while projects keep their custom mocks in local files that Lisa never touches.

**Branch:** `feat/jest-setup-inheritance` (from `main`)
**PR target:** `main`

## Implementation

### Task 1: Create branch and draft PR

Create `feat/jest-setup-inheritance` from `main`. Open a draft PR targeting `main`.

### Task 2: Move `jest.setup.ts` from create-only to copy-overwrite (expo)

**Files:**
- Delete: `expo/create-only/jest.setup.ts`
- Create: `expo/copy-overwrite/jest.setup.ts`

The new copy-overwrite version keeps ONLY the common base mocks that all expo projects need:
- RTLRN pure import + extend-expect
- `__unhandledRejectionHandler` global type declaration
- React 19 cleanup `afterEach`
- `ResizeObserver` mock
- `expo-router` mock (generic, all expo projects use this)
- `clearAllMocks` `afterEach`
- `typeof`-guarded `__unhandledRejectionHandler` removal in `afterAll`
- **Import `./jest.setup.local`** at the top (side-effect import)

**Remove from the base** (these are project-specific or not universal):
- `@/lib/env` mock (different per project)
- `@react-native-firebase/analytics` mock (not all projects use firebase)
- `firebase/analytics` mock (not all projects use firebase)

**Key detail:** Add `import "./jest.setup.local";` — since `jest.mock()` calls are hoisted by Jest regardless of import order, both base and local mocks are hoisted together. The import position doesn't affect mock behavior.

Update the JSDoc preamble to indicate this is Lisa-managed (`This file is managed by Lisa.`).

### Task 3: Create `jest.setup.local.ts` as create-only (expo)

**File:** `expo/create-only/jest.setup.local.ts`

Template contents:
```typescript
/**
 * Jest Setup - Project-Local Customizations
 *
 * Add project-specific jest.mock() calls, afterEach hooks, and other
 * test setup here. This file is create-only — Lisa will never overwrite it.
 *
 * Common additions:
 * - jest.mock("@/lib/env", ...) for environment variable mocking
 * - jest.mock("@sentry/react-native", ...) for Sentry
 * - jest.mock("nativewind", ...) for NativeWind/styling
 * - jest.mock("react-native-reanimated", ...) for animations
 * - Additional expo-* module mocks specific to your dependencies
 */
```

### Task 4: Move `jest.setup.pre.js` from create-only to copy-overwrite (expo)

**Files:**
- Delete: `expo/create-only/jest.setup.pre.js`
- Create: `expo/copy-overwrite/jest.setup.pre.js`

The copy-overwrite version keeps the common base pre-framework setup:
- `structuredClone` polyfill
- `__unhandledRejectionHandler` (stored on `global` for cleanup in `jest.setup.ts`)
- `RNTL_SKIP_AUTO_CLEANUP`
- `__DEV__`, `IS_REACT_ACT_ENVIRONMENT`, `IS_REACT_NATIVE_TEST_ENVIRONMENT`
- `__fbBatchedBridgeConfig`
- TurboModule proxy (`require("./jest.config.react-native-mock")`)
- Timer polyfills
- Window object mock
- **`require("./jest.setup.pre.local")`** at the end

Update the JSDoc preamble to indicate this is Lisa-managed.

### Task 5: Create `jest.setup.pre.local.js` as create-only (expo)

**File:** `expo/create-only/jest.setup.pre.local.js`

Template contents:
```javascript
/**
 * Jest Pre-Setup - Project-Local Customizations
 *
 * Add project-specific pre-framework globals here. This file runs before
 * Jest loads any test modules. This file is create-only — Lisa will never
 * overwrite it.
 *
 * Common additions:
 * - Additional global polyfills (setImmediate, ErrorUtils, Web Streams)
 * - Expo-specific polyfills (expo-modules-core global polyfill)
 * - Custom __ExpoImportMetaRegistry setup
 */
```

### Task 6: Update `jest.expo.ts` to register setup files

**File:** `expo/copy-overwrite/jest.expo.ts`

Change the `getExpoJestConfig` return to include:
```typescript
setupFiles: ["<rootDir>/jest.setup.pre.js"],
setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
```

Currently `setupFiles: []` — change to the above. Remove/update the JSDoc comments that explain why `setupFiles` is empty (they're no longer accurate).

**Compatibility:** `mergeConfigs` in `jest.base.ts` uses `[...new Set([...accVal, ...configVal])]` for arrays — so if a project's `jest.config.local.ts` still has `setupFiles: ["<rootDir>/jest.setup.pre.js"]`, deduplication prevents double-loading.

### Task 7: Update `jest.config.local.ts` create-only template

**File:** `expo/create-only/jest.config.local.ts`

Remove `setupFiles` and `setupFilesAfterEnv` from the template (they're now managed in `jest.expo.ts`). Keep only project-specific settings:
```typescript
const config: Config = {
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/generated/",
    "\\.mock\\.(ts|tsx|js|jsx)$",
  ],
};
```

Update the JSDoc remarks to remove the note about `setupFiles` needing to define `__DEV__`.

### Task 8: Include `components/ui` upstream in `tsconfig.expo.json`

**File:** `expo/copy-overwrite/tsconfig.expo.json`

This was already done earlier in this session — verify the change is present (added `"components/ui"` to `exclude` array).

### Task 9: Apply Lisa to ThumbWar and migrate project-specific mocks

Run `bun run dev /Users/cody/workspace/thumbwar/frontend` to apply updated templates.

Then migrate ThumbWar's project-specific mocks:

**`jest.setup.local.ts`** — move these mocks from the current `jest.setup.ts`:
- `expo/src/winter` mock
- `expo-modules-core` mock
- `react-native-reanimated` mock
- `expo-font`, `expo-splash-screen`, `expo-constants`, `expo-clipboard`, `expo-application`, `expo-updates` mocks
- `react-native-safe-area-context` mock
- `nativewind` mock
- `@sentry/react-native` mock (with ErrorBoundary)
- `apollo-link-sentry` mock
- `console.warn` silencing for `useNativeDriver`
- `jest.useFakeTimers({ advanceTimers: true })`
- `afterEach` clearAllTimers
- `afterAll` restore warn + useRealTimers

**`jest.setup.pre.local.js`** — move these from `jest.setup.pre.js` (if ThumbWar has project-specific additions beyond the base):
- `setImmediate`/`clearImmediate` polyfill
- `ErrorUtils` mock
- `__ExpoImportMetaRegistry` mock
- Web Streams API polyfill
- Expo global polyfill (`expo-modules-core/src/polyfill/dangerous-internal`)

**`jest.config.local.ts`** — remove `setupFiles` and `setupFilesAfterEnv` entries (now managed by `jest.expo.ts`).

### Task 10: Verify ThumbWar tests pass

```bash
cd /Users/cody/workspace/thumbwar/frontend && bun run test
```

Expected: 18 suites, 232 tests passing.

### Task 11: Apply Lisa to propswap/frontend and migrate project-specific mocks

Run `bun run dev /Users/cody/workspace/propswap/frontend` to apply updated templates.

Same migration pattern as ThumbWar: propswap has `jest.setup.js` (old) + `jest.setup.ts` (Lisa create-only) + `jest.setup.pre.js`. Move project-specific mocks from `jest.setup.js`/`jest.setup.ts` into `jest.setup.local.ts`, move project-specific pre-setup from `jest.setup.pre.js` into `jest.setup.pre.local.js`, remove `setupFiles`/`setupFilesAfterEnv` from `jest.config.local.ts`, delete old `jest.setup.js`.

### Task 12: Verify propswap/frontend tests pass

```bash
cd /Users/cody/workspace/propswap/frontend && bun run test
```

### Task 13: Apply Lisa to frontend-v2 and migrate

Run `bun run dev /Users/cody/workspace/geminisportsai/frontend-v2` and migrate similarly. Verify tests pass.

### Task 14: Run Lisa's own tests

```bash
bun run test
```

Verify Lisa's own test suite passes with the template changes.

### Task 15: Run linting and typecheck

```bash
bun run lint && bun run typecheck
```

### Task 16: CodeRabbit review

Run `coderabbit:review` on the changes.

### Task 17: Local code review

Run `/plan:local-code-review` on the branch.

### Task 18: Implement valid review suggestions

Address findings from Tasks 16-17.

### Task 19: Simplify code

Run code-simplifier agent on implemented changes.

### Task 20: Update tests

Update/add/remove tests as needed based on template changes.

### Task 21: Update documentation

- Update JSDoc preambles on all modified files
- Update any references to the old create-only jest.setup.ts pattern in Lisa docs/skills

### Task 22: Verify all task verification metadata

Re-run all verification commands from completed tasks.

### Task 23: Archive plan

- Create folder `jest-setup-inheritance` in `./plans/completed`
- Rename this plan to reflect actual contents
- Move into `./plans/completed/jest-setup-inheritance`
- Read session IDs from `./plans/completed/jest-setup-inheritance`
- Move `~/.claude/tasks/<session-id>` directories to `./plans/completed/jest-setup-inheritance/tasks`
- Update any `in_progress` tasks to `completed`
- Commit and push to PR

## Skills

- `/coding-philosophy` — all tasks
- `/jsdoc-best-practices` — Tasks 2-7, 19

## Verification

```bash
# Lisa's own tests
bun run test

# ThumbWar tests after migration
cd /Users/cody/workspace/thumbwar/frontend && bun run test

# propswap/frontend tests after migration
cd /Users/cody/workspace/propswap/frontend && bun run test

# frontend-v2 tests after migration
cd /Users/cody/workspace/geminisportsai/frontend-v2 && bun run test

# Linting
bun run lint && bun run typecheck
```
