# Lisa Changes Required for Expo SDK 56 Upgrade

This document outlines all changes needed in Lisa to support Expo SDK 56 across managed projects.

> **Status (SDK 56):** IMPLEMENTED on branch `expo-sdk-56-support`. frontend-v2
> upgraded **directly from SDK 54 → 56** (skipping 55). See the
> "## SDK 56 — Implemented changes" section at the end for exactly what landed,
> including breaking changes that only exist in 56 and gotchas discovered during
> the real upgrade.

## Context

Expo SDK 56 upgrades to **React Native 0.85** and **React 19.2**, makes Hermes v1
and bytecode diffing the defaults, **decouples `expo-router` from
`@react-navigation/*`** (codemod required), drops `@expo/vector-icons` from the
`expo` package, makes `expo/fetch` the global `fetch`, and (continuing from SDK
55) removes the legacy-architecture config flags and adopts the `/src` directory
convention. Lisa must be updated **before** downstream projects can upgrade.

Changelog: <https://expo.dev/changelog/sdk-56>
SDK 55 → 56 router migration: <https://docs.expo.dev/router/migrate/sdk-55-to-56>

---

## 1. Update Package Versions (`expo/package-lisa/package.lisa.json`)

### Dependencies (force section)

| Package | Current | SDK 56 Target |
|---|---|---|
| `expo` | `~54.0.31` | `~56.0.0` |
| `expo-application` | `~7.0.8` | `~56.0.0` |
| `expo-battery` | `~10.0.8` | `~56.0.0` |
| `expo-build-properties` | `~1.0.10` | `~56.0.0` |
| `expo-clipboard` | `~8.0.8` | `~56.0.0` |
| `expo-constants` | `~18.0.13` | `~56.0.0` |
| `expo-crypto` | `^15.0.8` | `~56.0.0` |
| `expo-dev-client` | `~6.0.20` | `~56.0.0` |
| `expo-device` | `~8.0.10` | `~56.0.0` |
| `expo-font` | `~14.0.10` | `~56.0.0` |
| `expo-linear-gradient` | `~15.0.8` | `~56.0.0` |
| `expo-linking` | `~8.0.11` | `~56.0.0` |
| `expo-localization` | `^17.0.8` | `~56.0.0` |
| `expo-network` | `~8.0.8` | `~56.0.0` |
| `expo-notifications` | `~0.32.16` | `~56.0.0` |
| `expo-router` | `~6.0.21` | `~56.0.0` |
| `expo-secure-store` | `~15.0.8` | `~56.0.0` |
| `expo-splash-screen` | `~31.0.13` | `~56.0.0` |
| `expo-status-bar` | `~3.0.9` | `~56.0.0` |
| `expo-system-ui` | `~6.0.9` | `~56.0.0` |
| `expo-updates` | `~29.0.16` | `~56.0.0` |
| `@expo/metro-runtime` | `~6.1.2` | Check SDK 56 compatible version |
| `@expo/html-elements` | `^0.12.5` | Check SDK 56 compatible version |
| `react` | `19.1.0` | `19.2.0` |
| `react-dom` | `19.1.0` | `19.2.0` |
| `react-native` | `0.81.4` | `0.85.x` |
| `react-native-gesture-handler` | `~2.30.0` | Check SDK 56 compatible version |
| `react-native-reanimated` | `~4.2.1` | Check SDK 56 compatible version |
| `react-native-screens` | `~4.19.0` | Check SDK 56 compatible version |
| `react-native-safe-area-context` | `^5.6.2` | Check SDK 56 compatible version |
| `react-native-keyboard-controller` | `1.20.4` | Check SDK 56 compatible version |
| `react-native-web` | `^0.21.2` | Check SDK 56 compatible version |
| `react-native-svg` | `^15.15.1` | Check SDK 56 compatible version |
| `@react-native-async-storage/async-storage` | `2.2.0` | Check SDK 56 compatible version |
| `@sentry/react-native` | `7.2.0` | Check RN 0.85 compatible version |
| `@shopify/flash-list` | `2.0.2` | Check SDK 56 compatible version |
| `@shopify/react-native-skia` | `2.2.12` | Check SDK 56 compatible version |
| `nativewind` | `^4.2.1` | Check SDK 56 compatible version |
| `tailwindcss` | `^3.4.7` | Check SDK 56 compatible version |

### DevDependencies (force section)

| Package | Current | SDK 56 Target |
|---|---|---|
| `jest-expo` | `^54.0.12` | `^56.0.0` |
| `@react-native-community/cli` | `^20.0.2` | Check SDK 56 compatible version |
| `@react-native-community/cli-platform-android` | `^20.0.2` | Check SDK 56 compatible version |
| `@react-native-community/cli-platform-ios` | `^20.0.2` | Check SDK 56 compatible version |
| `@testing-library/react-native` | `^13.0.0` | Check SDK 56 compatible version |
| `@types/react` | `~19.1.10` | Match React 19.2 types |
| `@types/react-dom` | `^19.1.7` | Match React 19.2 types |

> **Action**: Run `npx expo install expo@^56.0.0 --fix` in a test project to get the exact compatible versions for all packages, then update the manifest.

---

## 2. Update EAS Publish Scripts

The `eas update` command now **requires** the `--environment` flag (SDK 55+). Both `--channel` and `--environment` are used together: `--channel` selects which update channel to publish to, while `--environment` selects the EAS environment variable set. Update all `eas:publish` scripts in the force section:

```json
{
  "eas:publish:dev": "eas update --channel dev --environment development --non-interactive",
  "eas:publish:staging": "eas update --channel staging --environment preview --non-interactive",
  "eas:publish:production": "eas update --channel production --environment production --non-interactive"
}
```

> **Important:** The `--environment` value must exactly match the EAS environment name configured in your project (not the channel name). The standard EAS environment names are `development`, `preview`, and `production` — note that `development` maps to the `dev` channel, and `preview` maps to the `staging` channel.

---

## 3. Support `/src` Directory Convention

SDK 56's default template puts all application source code in `/src/`. Downstream projects (e.g., frontend-v2) will adopt this convention by moving **all** source directories into `src/`:

```
src/app/          (Expo Router routes)
src/components/   (shared UI components)
src/config/       (app configuration)
src/constants/    (constant values)
src/features/     (feature modules)
src/generated/    (GraphQL codegen output)
src/hooks/        (custom hooks)
src/lib/          (utility libraries)
src/providers/    (context providers)
src/stores/       (state stores)
src/types/        (TypeScript type definitions)
src/utils/        (helper functions)
```

Directories that stay at root: `assets/`, `__mocks__/`, `tests/`, `e2e/`, `scripts/`, `patches/`, `public/`

### Jest Config (`src/configs/jest/expo.ts`) — MUST UPDATE

`collectCoverageFrom` currently references root-level directories:

```typescript
// Current
"components/**/*.{ts,tsx}",
"features/**/*.{ts,tsx}",
"hooks/**/*.{ts,tsx}",
// etc.

// After migration
"src/components/**/*.{ts,tsx}",
"src/features/**/*.{ts,tsx}",
"src/hooks/**/*.{ts,tsx}",
// etc.
```

**Option A**: Prefix all patterns with `src/` (breaking for projects that haven't migrated).

**Option B**: Use a configurable `sourceRoot` parameter in `getExpoConfig()` that defaults to `""` but can be set to `"src/"`. Projects pass their source root and Lisa generates the right patterns.

**Recommendation**: Option B — backwards-compatible, lets projects migrate on their own schedule.

### ESLint Config (`src/configs/eslint/expo.ts`) — MUST UPDATE

File patterns reference `features/**/components/**`, `components/**`, etc. These need the same `src/` prefix or configurable source root.

### TypeScript Config (`tsconfig/expo.json`)

No changes needed to the base config. Projects update their `tsconfig.local.json` to point `@/*` to `"./src/*"`.

### Babel Config (`expo/create-only/babel.config.js`)

This is a create-only file — Lisa won't overwrite it. But the **template** for new projects should default to `src/`-prefixed aliases. Existing projects update their own `babel.config.js` manually.

### Tailwind Content Paths

Not managed by Lisa (project-level `tailwind.config.js`), but downstream projects will need to update content arrays to scan `src/` directories.

---

## 4. Review Jest Setup (`expo/copy-overwrite/jest.setup.ts`)

Current setup has workarounds for:

- React 19 null-throw during cleanup (GitHub: expo/expo#38046)
- Jest 30 compatibility with expo-router (GitHub: expo/expo#40184)

**Action**: Check if these issues are resolved in SDK 56 / jest-expo 56. If so, remove the workarounds. If not, verify they still work with the new versions.

---

## 5. Review Metro Workarounds

The frontend-v2 project has a workaround in `metro.config.js` for Symbol serialization when `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` is enabled (expo/expo#39431).

**Action**: Check if this is fixed in SDK 56's Metro bundler. If so, the workaround can be removed from downstream projects.

---

## 6. Node.js Version

SDK 56 supports: `^20.19.4`, `^22.13.0`, `^24.3.0`, `^25.0.0`

Current EAS build node version: `22.21.1` (compatible).
Current `.nvmrc`: managed by Lisa.

**Action**: Verify the `.nvmrc` version Lisa manages is within SDK 56's supported range. Update if needed.

---

## 7. Xcode Version

SDK 56 requires Xcode 26.4 minimum. EAS Build defaults to a compatible Xcode 26.x image.

**Action**: Check if `eas.json` templates or build profiles reference a specific Xcode/image version. If so, ensure they target Xcode 26+.

---

## 8. Checklist

- [ ] Update all package versions in `expo/package-lisa/package.lisa.json`
- [ ] Update `eas:publish` scripts with `--environment` flag
- [ ] Add configurable `sourceRoot` to Jest config (`src/configs/jest/expo.ts`) for `/src` convention
- [ ] Add configurable `sourceRoot` to ESLint config (`src/configs/eslint/expo.ts`) for `/src` convention
- [ ] Update create-only babel template for new projects to default to `src/` aliases
- [ ] Verify Jest setup workarounds still needed or can be removed
- [ ] Verify Metro workarounds still needed or can be removed
- [ ] Verify Node.js version in `.nvmrc` is compatible
- [ ] Verify Xcode version in EAS build profiles
- [ ] Run `lisa .` on a test project (both with and without `/src` convention) and verify all managed files are correct
- [ ] Run full test suite on updated test project
- [ ] Publish new Lisa version with SDK 56 support

---

## SDK 56 — Implemented changes

What actually landed in Lisa (branch `expo-sdk-56-support`) when frontend-v2 went
SDK 54 → 56. Resolved versions came from `npx expo install expo@^56.0.0 --fix`.

### 1. `expo/package-lisa/package.lisa.json`

- `expo ~56.0.0`, `react`/`react-dom` `19.2.3`, `react-native 0.85.3`, and every
  `expo-*` package repinned to its `~56.x` line (router `~56.2.7`,
  updates `~56.0.17`, constants `~56.0.16`, etc.).
- Third-party RN libs: `@shopify/react-native-skia 2.6.2`,
  `@sentry/react-native ~7.11.0`, `react-native-reanimated 4.3.1`,
  `react-native-screens 4.25.2`, `react-native-gesture-handler ~2.31.1`,
  `react-native-keyboard-controller 1.21.6`.
- Dev: `jest-expo ~56.0.4`, `@types/react ~19.2.15`, `@types/react-dom ~19.2.3`,
  and a **new** `react-test-renderer 19.2.3` pin (see gotcha #2).
- `eas:publish:*` scripts now pass `--environment` (development/preview/production)
  **in addition to** `--channel` — `--environment` is required for SDK 55+, but
  `--channel` still selects the update channel, so both are needed.

### 2. `src/configs/jest/expo.ts` (base jest config)

- **Resolver moved:** `react-native/jest/resolver.js` →
  `@react-native/jest-preset/jest/resolver.js` (RN 0.85 relocated it). Without
  this Jest cannot even load (`Resolver module not found`) and platform-extension
  files (`.ios`/`.native`/`.web`) don't resolve.
- Added a `sourceRoot` option (default `""`). Projects on `/src` pass
  `sourceRoot: "src/"` so `collectCoverageFrom` collects from `src/components`,
  `src/features`, … instead of silently collecting nothing.

### 3. `src/configs/eslint/expo.ts` (base eslint config)

- Added a `sourceRoot` option that prefixes the component-structure,
  ui-standards, and view-memo file globs, so those guardrails actually target
  `src/...` under the `/src` convention (previously root-anchored → silently
  unenforced).

### 4. `expo/create-only/jest.config.react-native-mock.js`

- Added an `AccessibilityManager` TurboModule mock (gotcha #3).

### 5. `plugins/lisa-expo/skills/directory-structure`

- `validate_structure.py` now auto-detects a `src/` directory and validates
  source there (it previously scanned the empty root → a false 0-error pass).
- `SKILL.md` documents the `/src` layout and which directories stay at root.

### Gotchas discovered during the real upgrade (SDK-56-specific)

1. **`expo-router` no longer depends on `@react-navigation/*`.** All direct
   `@react-navigation/native` / `@react-navigation/elements` imports must move to
   `expo-router/react-navigation` (codemod:
   `npx expo-codemod sdk-56-expo-router-react-navigation-replace src`). Remove
   now-unused `@react-navigation/*` deps. `HeaderBackButton` dropped the
   `labelVisible` prop — use `displayMode="minimal"` to hide the label.
2. **`react-test-renderer` must equal the React version.** `@testing-library/
   react-native` 13.3 hard-errors if `react-test-renderer` (a stale transitive)
   doesn't match React (`19.2.3`). Pin it explicitly.
3. **`AccessibilityManager` TurboModule mock.** RN 0.85's `AccessibilityInfo`
   eagerly reads the `AccessibilityManager` TurboModule; unmocked it rejects with
   `NativeAccessibilityManagerIOS is not available`, which the `unhandledRejection`
   handler turns into a Jest worker crash across every suite touching
   accessibility.
4. **RN 0.85 style props.** `style` reaches host nodes as an array (and `Text`
   adds a default `overflow: "hidden"`); tests asserting a flattened style object
   must use `StyleSheet.flatten(...)` + `objectContaining`.
5. **Reanimated 4.3 `useAnimatedStyle`** returns an `AnimatedStyleHandle`; pass it
   straight to `Animated.View` (sole `style`), or cast at the boundary when it
   flows into a `StyleProp<ViewStyle>`-typed prop or a mixed `style={[...]}` array.
6. **`expo install --fix` does not bump** `jest-expo`, `eslint-config-expo`,
   `@types/react`, or `react-test-renderer` — set those by hand. Keep jest 30 (Lisa
   standard) and add `jest`/`@types/jest` to `expo.install.exclude`.
7. **expo-doctor `PackageJsonCheck`** flags any npm script whose name equals a
   `node_modules/.bin` entry (e.g. `"knip": "knip"`) with no config escape; rename
   the script (e.g. `knip:check`).

**Sources.** Each gotcha above was verified empirically during the SE-4125
frontend-v2 upgrade (expo-doctor output, CI/Jest logs, and a pre/post coverage
baseline), cross-referenced with: the [Expo SDK 56 changelog](https://expo.dev/changelog/sdk-56),
the [SDK 55→56 router migration guide](https://docs.expo.dev/router/migrate/sdk-55-to-56)
(#1, react-navigation decoupling), React Native 0.85 release notes (#3
AccessibilityManager spec, #4 style props), the `react-native-reanimated` v4
types (#5 `AnimatedStyleHandle`), `@testing-library/react-native` v13 peer-dep
enforcement (#2 `react-test-renderer`), and `npx expo install --check` /
`expo-doctor@latest` behavior (#6, #7).
