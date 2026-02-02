# Fix: Jest setupFiles ordering breaks Expo projects on pre-push

## Problem

Lisa's `jest.expo.ts` template includes `setupFiles: ["jest-expo/src/preset/setup.js"]`. When projects define their own `setupFiles` in `jest.config.local.ts` (e.g., to set `global.__DEV__ = true`), `mergeConfigs` concatenates the arrays with the **base config entries first**:

```
merged setupFiles: ["jest-expo/src/preset/setup.js", "<rootDir>/jest.setup.pre.js"]
```

`jest-expo/src/preset/setup.js` loads `NativeModules` which requires `__DEV__` to exist, but the project's pre-setup file that defines `__DEV__` runs after it. Result: **every test suite fails** with `ReferenceError: __DEV__ is not defined`.

This blocks `pre-push` hooks (which run `test:cov` and `test:integration`).

## Root Cause

`mergeConfigs` in `jest.base.ts` (line 96) uses `[...new Set([...accVal, ...configVal])]` for array merging - base entries always come first. There's no way for a local config to **prepend** entries.

## Fix

### Part 1: Fix Lisa upstream (jest.expo.ts template)

**File**: `expo/copy-overwrite/jest.expo.ts`

Remove `jest-expo/src/preset/setup.js` from `setupFiles`. This file requires `__DEV__` to be pre-defined, and there's no safe way to guarantee ordering with `mergeConfigs`. Projects that need it can add it in their local config in the correct order after their `__DEV__` setup.

Change line 75 from:
```ts
setupFiles: ["jest-expo/src/preset/setup.js"],
```
to:
```ts
setupFiles: [],
```

Update the JSDoc preamble to explain why setupFiles is empty and that projects should provide their own setup order.

### Part 2: Fix propswap/frontend (immediate unblock)

**File**: `/Users/cody/workspace/propswap/frontend/jest.config.local.ts`

Add `jest-expo/src/preset/setup.js` to the local config's `setupFiles` AFTER the `__DEV__` setup file:

```ts
setupFiles: ["<rootDir>/jest.setup.pre.js", "jest-expo/src/preset/setup.js"],
```

This ensures `__DEV__` is defined before `jest-expo/src/preset/setup.js` tries to use it.

### Part 3: Check other expo projects

The other workspace projects (`geminisportsai/frontend-v2`, `thumbwar/frontend`) don't have `jest.expo.ts` files, so they're not affected.

## Files to Modify

| File | Repo | Change |
|------|------|--------|
| `expo/copy-overwrite/jest.expo.ts` | lisa | Remove `jest-expo/src/preset/setup.js` from setupFiles, update preamble |
| `jest.config.local.ts` | propswap/frontend | Add `jest-expo/src/preset/setup.js` after `jest.setup.pre.js` in setupFiles |

## Skills to Use

- `/git:commit` for atomic commits in each repo
- `/jsdoc-best-practices` when updating the jest.expo.ts preamble

## Tasks (parallelizable where noted)

1. **Update Lisa jest.expo.ts template** - Remove `jest-expo/src/preset/setup.js` from setupFiles, update JSDoc preamble
2. **Update propswap jest.config.local.ts** - Add `jest-expo/src/preset/setup.js` after `jest.setup.pre.js` (can run in parallel with task 1)
3. **Run propswap tests** to verify fix works (depends on task 2)
4. **Commit Lisa changes** (depends on task 1)
5. **Commit propswap changes** (depends on task 3)
6. **Push propswap** to verify pre-push hook passes (depends on task 5)

## Verification

```bash
# In propswap/frontend - verify tests pass
cd /Users/cody/workspace/propswap/frontend
bun run test:unit -- --bail --testPathPatterns="__tests__" 2>&1 | tail -5

# In propswap/frontend - verify full pre-push passes
bun run test:cov

# In lisa - verify lint/typecheck still pass
cd /Users/cody/workspace/lisa
bun run lint && bun run typecheck
```
