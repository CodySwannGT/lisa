# Lisa Changes Required for Expo SDK 55 Upgrade

This document outlines all changes needed in Lisa to support Expo SDK 55 across managed projects.

## Context

Expo SDK 55 upgrades to React Native 0.83 and React 19.2, removes legacy architecture config flags, changes EAS CLI requirements, and introduces a new `/src` directory convention. Lisa must be updated **before** downstream projects can upgrade.

Changelog: <https://expo.dev/changelog/sdk-55>

---

## 1. Update Package Versions (`expo/package-lisa/package.lisa.json`)

### Dependencies (force section)

| Package | Current | SDK 55 Target |
|---|---|---|
| `expo` | `~54.0.31` | `~55.0.0` |
| `expo-application` | `~7.0.8` | `~55.0.0` |
| `expo-battery` | `~10.0.8` | `~55.0.0` |
| `expo-build-properties` | `~1.0.10` | `~55.0.0` |
| `expo-clipboard` | `~8.0.8` | `~55.0.0` |
| `expo-constants` | `~18.0.13` | `~55.0.0` |
| `expo-crypto` | `^15.0.8` | `~55.0.0` |
| `expo-dev-client` | `~6.0.20` | `~55.0.0` |
| `expo-device` | `~8.0.10` | `~55.0.0` |
| `expo-font` | `~14.0.10` | `~55.0.0` |
| `expo-linear-gradient` | `~15.0.8` | `~55.0.0` |
| `expo-linking` | `~8.0.11` | `~55.0.0` |
| `expo-localization` | `^17.0.8` | `~55.0.0` |
| `expo-network` | `~8.0.8` | `~55.0.0` |
| `expo-notifications` | `~0.32.16` | `~55.0.0` |
| `expo-router` | `~6.0.21` | `~55.0.0` |
| `expo-secure-store` | `~15.0.8` | `~55.0.0` |
| `expo-splash-screen` | `~31.0.13` | `~55.0.0` |
| `expo-status-bar` | `~3.0.9` | `~55.0.0` |
| `expo-system-ui` | `~6.0.9` | `~55.0.0` |
| `expo-updates` | `~29.0.16` | `~55.0.0` |
| `@expo/metro-runtime` | `~6.1.2` | Check SDK 55 compatible version |
| `@expo/html-elements` | `^0.12.5` | Check SDK 55 compatible version |
| `react` | `19.1.0` | `19.2.0` |
| `react-dom` | `19.1.0` | `19.2.0` |
| `react-native` | `0.81.4` | `0.83.x` |
| `react-native-gesture-handler` | `~2.30.0` | Check SDK 55 compatible version |
| `react-native-reanimated` | `~4.2.1` | Check SDK 55 compatible version |
| `react-native-screens` | `~4.19.0` | Check SDK 55 compatible version |
| `react-native-safe-area-context` | `^5.6.2` | Check SDK 55 compatible version |
| `react-native-keyboard-controller` | `1.20.4` | Check SDK 55 compatible version |
| `react-native-web` | `^0.21.2` | Check SDK 55 compatible version |
| `react-native-svg` | `^15.15.1` | Check SDK 55 compatible version |
| `@react-native-async-storage/async-storage` | `2.2.0` | Check SDK 55 compatible version |
| `@sentry/react-native` | `7.2.0` | Check RN 0.83 compatible version |
| `@shopify/flash-list` | `2.0.2` | Check SDK 55 compatible version |
| `@shopify/react-native-skia` | `2.2.12` | Check SDK 55 compatible version |
| `nativewind` | `^4.2.1` | Check SDK 55 compatible version |
| `tailwindcss` | `^3.4.7` | Check SDK 55 compatible version |

### DevDependencies (force section)

| Package | Current | SDK 55 Target |
|---|---|---|
| `jest-expo` | `^54.0.12` | `^55.0.0` |
| `@react-native-community/cli` | `^20.0.2` | Check SDK 55 compatible version |
| `@react-native-community/cli-platform-android` | `^20.0.2` | Check SDK 55 compatible version |
| `@react-native-community/cli-platform-ios` | `^20.0.2` | Check SDK 55 compatible version |
| `@testing-library/react-native` | `^13.0.0` | Check SDK 55 compatible version |
| `@types/react` | `~19.1.10` | Match React 19.2 types |
| `@types/react-dom` | `^19.1.7` | Match React 19.2 types |

> **Action**: Run `npx expo install expo@^55.0.0 --fix` in a test project to get the exact compatible versions for all packages, then update the manifest.

---

## 2. Update EAS Publish Scripts

The `eas update` command now **requires** the `--environment` flag. Update all `eas:publish` scripts in the force section:

```json
{
  "eas:publish:dev": "eas update --environment dev --non-interactive",
  "eas:publish:staging": "eas update --environment staging --non-interactive",
  "eas:publish:production": "eas update --environment production --non-interactive"
}
```

The `--channel` flag may be deprecated or may need to be used alongside `--environment`. Verify with `eas update --help` after upgrading EAS CLI.

---

## 3. Support `/src` Directory Convention

SDK 55's default template puts all application source code in `/src/`. Downstream projects (e.g., frontend-v2) will adopt this convention by moving **all** source directories into `src/`:

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

**Action**: Check if these issues are resolved in SDK 55 / jest-expo 55. If so, remove the workarounds. If not, verify they still work with the new versions.

---

## 5. Review Metro Workarounds

The frontend-v2 project has a workaround in `metro.config.js` for Symbol serialization when `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` is enabled (expo/expo#39431).

**Action**: Check if this is fixed in SDK 55's Metro bundler. If so, the workaround can be removed from downstream projects.

---

## 6. Node.js Version

SDK 55 supports: `^20.19.4`, `^22.13.0`, `^24.3.0`, `^25.0.0`

Current EAS build node version: `22.21.1` (compatible).
Current `.nvmrc`: managed by Lisa.

**Action**: Verify the `.nvmrc` version Lisa manages is within SDK 55's supported range. Update if needed.

---

## 7. Xcode Version

SDK 55 requires Xcode 26 minimum. EAS Build defaults to Xcode 26.2.

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
- [ ] Publish new Lisa version with SDK 55 support
