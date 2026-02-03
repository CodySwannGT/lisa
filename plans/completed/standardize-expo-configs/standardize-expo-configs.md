# Standardize Expo Project Configs & Fix Lisa Template Gaps

**Branch**: `fix/expo-knip-and-tsconfig` (PR #137 → main)
**Push strategy**: Push to existing PR #137

## Context

Three Expo projects (propswap, geminisportsai, thumbwar) share the same Lisa-managed base files but have divergent project-specific configs. Investigation revealed:

1. **propswap's `tsconfig.expo.json`** predates the current Lisa template — uses explicit per-directory path aliases instead of catch-all `@/*`, missing `noEmit`/`allowImportingTsExtensions`, has unnecessary `useUnknownInCatchVariables: false`
2. **Lisa expo templates are missing** a create-only `jest.config.local.ts` and `babel.config.js`, causing each project to independently create these files with inconsistent patterns

## Changes

### 1. Add `expo/create-only/jest.config.local.ts`

The typescript stack provides a create-only `jest.config.local.ts` template but the expo stack doesn't. All three expo projects created their own independently. Add a create-only template with sensible Expo defaults.

**File**: `expo/create-only/jest.config.local.ts`

Model after `typescript/create-only/jest.config.local.ts` but with Expo-specific example content:
- `setupFiles` pointing to `jest.setup.pre.js`
- `setupFilesAfterEnv` pointing to `jest.setup.ts`
- `moduleNameMapper` with `@/*` catch-all
- Example `coveragePathIgnorePatterns` for `/generated/`

### 2. Add `expo/create-only/babel.config.js`

The `jest.expo.ts` template uses `babel-jest` with metro caller config, which requires a `babel.config.js` in projects. All three projects have one but Lisa doesn't provide a template. Add a create-only template.

**File**: `expo/create-only/babel.config.js`

Content based on the common pattern across all three projects:
- `babel-preset-expo` with `jsxImportSource: "nativewind"`
- `nativewind/babel` preset

No `module-resolver` plugin — thumbwar works fine without it (the catch-all `@/*` tsconfig path + jest `moduleNameMapper` handle resolution). Projects that need it can add it in their copy.

### 3. Add `expo/create-only/jest.setup.pre.js`

All three projects have identical `jest.setup.pre.js` files. Rather than copy-overwrite (which would be too rigid for setup files), provide a create-only template so new projects start with the working boilerplate.

**File**: `expo/create-only/jest.setup.pre.js`

Content: The shared pattern from all three projects (React Native globals, TurboModule proxy stub, structuredClone polyfill, React 19 null-throw handler).

### 4. Add `expo/create-only/jest.setup.ts`

Same rationale as jest.setup.pre.js — identical across projects.

**File**: `expo/create-only/jest.setup.ts`

Content: The shared pattern (RTLRN cleanup, expo-router mock, firebase mock, env mock placeholder).

### 5. Add `expo/create-only/jest.config.react-native-mock.js`

Provide a baseline React Native mock config. Projects extend with their own modules.

**File**: `expo/create-only/jest.config.react-native-mock.js`

Content: Minimal shared mocks (PlatformConstants, AppState, Appearance, DeviceInfo) that all three projects use. Projects add more as needed.

### 6. Update `expo/copy-overwrite/tsconfig.json` to include `nativewind-env.d.ts`

The Lisa template's `tsconfig.json` doesn't include `nativewind-env.d.ts` in its `include` array, but geminisportsai and thumbwar both added it manually. Since all expo projects use NativeWind, add it to the template.

**File**: `expo/copy-overwrite/tsconfig.json`

Change `include` from `["**/*.ts", "**/*.tsx"]` to `["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"]`.

### 7. Standardize propswap configs (separate branch in propswap repo)

These changes happen in `/Users/cody/workspace/propswap/frontend`, on a new branch off propswap's main. After Lisa template changes are committed, run `lisa:update` in propswap to pull the new template, then:

a. **`tsconfig.expo.json` gets replaced by Lisa** — The `lisa:update` command will overwrite it with the standard template (copy-overwrite). The catch-all `@/*` path works (verified: all imports follow the pattern). Remove `useUnknownInCatchVariables: false` (not needed — no untyped catch blocks exist).

b. **Simplify `jest.config.local.ts`** — Remove duplicated config already in `jest.expo.ts`:
   - Remove `preset: ""` override (jest.expo.ts doesn't set a preset)
   - Remove `haste`, `resolver`, `transform` (already in jest.expo.ts)
   - Keep: `setupFiles`, `setupFilesAfterEnv`, `moduleNameMapper`, `transformIgnorePatterns` (project has extra packages), `testPathIgnorePatterns`, `coveragePathIgnorePatterns`, `collectCoverageFrom`

c. **Simplify `babel.config.js`** — Remove `module-resolver` plugin (unnecessary with catch-all `@/*` in tsconfig + jest `moduleNameMapper`). Keep `babel-preset-expo` with nativewind.

d. **Run propswap tests** to verify nothing breaks: `bun run test` and `bun run typecheck`

e. **Create PR in propswap repo** targeting propswap's main branch

## Files Modified

### Lisa repo (`/Users/cody/workspace/lisa`, PR #137)

| File | Action | Type |
|------|--------|------|
| `expo/create-only/jest.config.local.ts` | Create | create-only template |
| `expo/create-only/babel.config.js` | Create | create-only template |
| `expo/create-only/jest.setup.pre.js` | Create | create-only template |
| `expo/create-only/jest.setup.ts` | Create | create-only template |
| `expo/create-only/jest.config.react-native-mock.js` | Create | create-only template |
| `expo/copy-overwrite/tsconfig.json` | Edit | add nativewind-env.d.ts |

### Propswap repo (`/Users/cody/workspace/propswap/frontend`, new branch + PR)

| File | Action | Details |
|------|--------|---------|
| `tsconfig.expo.json` | Replaced by Lisa | copy-overwrite from template |
| `jest.config.local.ts` | Edit | remove duplicated haste/resolver/transform/preset |
| `babel.config.js` | Edit | remove module-resolver plugin |

## Skills to Use

- `/jsdoc-best-practices` — when writing JSDoc for new template files
- `/git:commit` — for atomic conventional commits
- `/git:submit-pr` — push to existing PR #137

## Task List

Create these tasks with `TaskCreate`. Subagents should handle tasks 1-5 in parallel (independent file creations), task 6 can also run in parallel:

### Lisa repo tasks

1. **Create `expo/create-only/jest.config.local.ts`** — Expo-specific Jest local config template with setupFiles, moduleNameMapper, and coveragePathIgnorePatterns examples. Model after `typescript/create-only/jest.config.local.ts`. Use `/jsdoc-best-practices`.
2. **Create `expo/create-only/babel.config.js`** — Babel config template with babel-preset-expo and nativewind presets. Use `/jsdoc-best-practices`.
3. **Create `expo/create-only/jest.setup.pre.js`** — Pre-setup template with React Native globals, TurboModule proxy, structuredClone polyfill. Use the shared pattern from geminisportsai (`/Users/cody/workspace/geminisportsai/frontend-v2/jest.setup.pre.js`) as the source since it's identical across projects. Use `/jsdoc-best-practices`.
4. **Create `expo/create-only/jest.setup.ts`** — Post-env setup template with RTLRN cleanup, expo-router mock, firebase mock. Use geminisportsai's as source. Remove project-specific env mock (replace with placeholder comment). Use `/jsdoc-best-practices`.
5. **Create `expo/create-only/jest.config.react-native-mock.js`** — Baseline React Native TurboModule mocks (PlatformConstants, AppState, Appearance, DeviceInfo). Use propswap's minimal version as source. Use `/jsdoc-best-practices`.
6. **Update `expo/copy-overwrite/tsconfig.json`** — Add `nativewind-env.d.ts` to include array
7. **Add/update tests** — Verify new template files pass Lisa's lint and typecheck. Run `bun run test`, `bun run lint`, `bun run typecheck` in Lisa repo.
8. **Update documentation** — Ensure all new files have proper JSDoc preambles (should be done as part of tasks 1-5 via `/jsdoc-best-practices`). No markdown doc changes needed.
9. **Commit and push Lisa changes to PR #137** — Use `/git:commit` for atomic commits, then `/git:submit-pr` to push

### Propswap repo tasks (after Lisa tasks complete)

10. **Run local Lisa on propswap** — From the Lisa repo: `bun run dev /Users/cody/workspace/propswap/frontend -y`. This uses the local (unpublished) Lisa to apply the updated templates, replacing `tsconfig.expo.json` with the standard template.
11. **Simplify propswap `jest.config.local.ts`** — Remove duplicated haste/resolver/transform/preset override. Keep setupFiles, moduleNameMapper, transformIgnorePatterns, testPathIgnorePatterns, coveragePathIgnorePatterns, collectCoverageFrom.
12. **Simplify propswap `babel.config.js`** — Remove `module-resolver` plugin and its aliases. Keep babel-preset-expo with nativewind.
13. **Verify propswap** — Run `bun run test`, `bun run typecheck`, `bun run lint` in propswap to confirm nothing breaks.
14. **Commit and create propswap PR** — New branch in propswap repo, PR targeting propswap's main. Use `/git:commit-and-submit-pr`.

### Cleanup

15. **Archive the plan** — After all tasks complete:
    - Create folder `standardize-expo-configs` in `./plans/completed`
    - Rename this plan to match its contents
    - Move it into `./plans/completed/standardize-expo-configs/`
    - Read session IDs from the moved plan file
    - Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/standardize-expo-configs/tasks`

## Verification

### Lisa repo

```bash
# In /Users/cody/workspace/lisa
bun run typecheck
bun run test
bun run lint
```

### Propswap repo

```bash
# In /Users/cody/workspace/propswap/frontend
bun run typecheck
bun run test
bun run lint
```

## Sessions
| 22a4758d-2145-4096-91a4-a12d9ce40001 | 2026-02-03T00:41:30Z | plan |
