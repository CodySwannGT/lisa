# Fix Expo Jest Template — Upstream PropSwap Fixes

## Problem

After running `lisa` on `propswap/frontend`, two issues required manual fixes:

1. **jest-expo preset + jsdom incompatibility**: The `jest-expo` preset's `setupFiles` include `react-native/jest/setup.js`, which redefines `window` via `Object.defineProperties`. But jsdom defines `window` as non-configurable, causing `"Cannot redefine property: window"` in every test suite. ([expo/expo#40184](https://github.com/expo/expo/issues/40184))

2. **`collectCoverageFrom` too broad**: The template uses `"**/*.{ts,tsx}"` which matches config files, eslint plugins, scripts, etc. — inflating or distorting coverage numbers. Because `mergeConfigs` concatenates arrays, projects can't replace this pattern from `jest.config.local.ts`.

## Changes

### 1. `expo/copy-overwrite/jest.expo.ts` (modify)

Replace the `jest-expo` preset with explicit manual configuration:

- **Remove** `preset: "jest-expo"`
- **Add** `haste`, `resolver`, `transform`, and `setupFiles` matching what jest-expo provides minus the problematic `react-native/jest/setup.js`:
  ```typescript
  haste: { defaultPlatform: "ios", platforms: ["android", "ios", "native"] },
  resolver: "react-native/jest/resolver.js",
  setupFiles: ["jest-expo/src/preset/setup.js"],
  transform: {
    "\\.[jt]sx?$": ["babel-jest", { caller: { name: "metro", bundler: "metro", platform: "ios" } }],
    "^.+\\.(bmp|gif|jpg|jpeg|png|psd|svg|webp|mp4|...)$": "jest-expo/src/preset/assetFileTransformer.js",
  },
  ```
- **Replace** `collectCoverageFrom` broad glob with scoped Expo source directories:
  ```typescript
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "config/**/*.{ts,tsx}",
    "constants/**/*.{ts,tsx}",
    "features/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "providers/**/*.{ts,tsx}",
    "shared/**/*.{ts,tsx}",
    "stores/**/*.{ts,tsx}",
    "types/**/*.{ts,tsx}",
    "utils/**/*.{ts,tsx}",
    "!**/*.d.ts",
    ...defaultCoverageExclusions,
  ],
  ```
- **Update** JSDoc preamble to reflect no-preset approach (use `/jsdoc-best-practices` skill)

### 2. `tests/unit/config/jest-expo.test.ts` (create)

Follow pattern from `tests/unit/config/jest-base.test.ts`. Test:
- No `preset` key in output config
- `testEnvironment` is `"jsdom"`
- `haste` has correct platform config
- `resolver` points to `react-native/jest/resolver.js`
- `setupFiles` includes `jest-expo/src/preset/setup.js` only (not `react-native/jest/setup.js`)
- `collectCoverageFrom` patterns are directory-scoped (no `**/*.{ts,tsx}` catch-all)
- `transform` includes babel-jest and asset transformer
- Default thresholds are applied when no overrides given
- Custom thresholds are applied when overrides given

### 3. `OVERVIEW.md` (modify)

Update line ~597 from:
> `jest-expo preset, jsdom environment, React Native transforms`

To:
> `Manual React Native resolution (jsdom-compatible), scoped Expo directory coverage`

### 4. `expo/copy-overwrite/.claude/skills/testing-library/SKILL.md` (check/modify)

Check for references to `jest-expo` preset and update if needed.

## Critical Files

| File | Action |
|------|--------|
| `expo/copy-overwrite/jest.expo.ts` | Modify — drop preset, add manual RN config, scope coverage |
| `tests/unit/config/jest-expo.test.ts` | Create — tests for `getExpoJestConfig` |
| `OVERVIEW.md` | Modify — update Expo Jest description |
| `typescript/copy-overwrite/jest.base.ts` | Reference only — not modified |
| `expo/copy-overwrite/jest.config.ts` | Reference only — not modified |
| `tests/unit/config/jest-base.test.ts` | Reference — test pattern to follow |

## Skills to Use

- `/jsdoc-best-practices` — when updating JSDoc preamble in `jest.expo.ts`

## Task Parallelization

Tasks 1-2 can run in parallel (different files). Task 3-4 depend on task 1 (need to know final wording).

## Verification

```bash
# Run new expo config tests
bun run test -- tests/unit/config/jest-expo.test.ts

# Run all tests — no regressions
bun run test

# Lint
bun run lint

# Typecheck
bun run typecheck
```
