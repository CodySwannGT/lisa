# Plan: Add TSConfig and Jest Governance (Matching ESLint Pattern)

## Overview

Add governed tsconfig and jest configurations to Lisa following the exact same inheritance pattern as ESLint: Lisa owns entry points (copy-overwrite), stack-specific configs extend a shared base, and projects customize via create-only local files and threshold overrides.

## Inheritance Chains

### ESLint (existing, for reference)

```
eslint.config.ts          (copy-overwrite, per-stack entry point)
├── eslint.{stack}.ts     (copy-overwrite, stack config)
│   └── eslint.typescript.ts  (copy-overwrite, typescript base)
│       └── eslint.base.ts    (copy-overwrite, shared utilities)
├── eslint.config.local.ts    (create-only, project customizations)
├── eslint.thresholds.json    (create-only, overridable thresholds)
└── eslint.ignore.config.json (copy-overwrite, ignore patterns)
```

### TSConfig (new)

```
tsconfig.json             (copy-overwrite, per-stack entry point)
├── tsconfig.{stack}.json (copy-overwrite, stack config)
│   └── tsconfig.base.json    (copy-overwrite, governance settings)
└── tsconfig.local.json        (create-only, project paths/includes/excludes)
```

Uses TS 5.0+ array `extends`: `"extends": ["./tsconfig.{stack}.json", "./tsconfig.local.json"]`

### Jest (new)

```
jest.config.ts            (copy-overwrite, per-stack entry point)
├── jest.{stack}.ts       (copy-overwrite, stack config)
│   └── jest.base.ts          (copy-overwrite, shared utilities)
├── jest.config.local.ts      (create-only, project customizations)
└── jest.thresholds.json      (create-only, coverage thresholds)
```

## Files to Create

### TSConfig Files

#### Shared Base (`typescript/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.base.json` | copy-overwrite | Governance-enforced settings for ALL TS projects |
| `tsconfig.typescript.json` | copy-overwrite | TypeScript stack defaults (extends base) |
| `tsconfig.json` | copy-overwrite | Entry point for typescript stack |

**`tsconfig.base.json`** - Common governance settings:
```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "sourceMap": true,
    "baseUrl": "./"
  }
}
```

**`tsconfig.typescript.json`** - TypeScript/Node stack:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

**`tsconfig.json`** - Entry point:
```json
{
  "extends": ["./tsconfig.typescript.json", "./tsconfig.local.json"],
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Shared Create-Only (`typescript/create-only/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.local.json` | create-only | Project-specific paths, includes, excludes |

**`tsconfig.local.json`**:
```json
{
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

#### Expo Stack (`expo/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.expo.json` | copy-overwrite | Expo stack settings |
| `tsconfig.json` | copy-overwrite | Entry point for expo stack |

**`tsconfig.expo.json`**:
```json
{
  "extends": ["expo/tsconfig.base", "./tsconfig.base.json"],
  "compilerOptions": {
    "strict": true,
    "jsx": "react-native",
    "baseUrl": "./",
    "moduleSuffixes": [".ios", ".android", ".native", ".web", ""]
  }
}
```

**`tsconfig.json`** (expo entry point):
```json
{
  "extends": ["./tsconfig.expo.json", "./tsconfig.local.json"]
}
```

#### Expo Create-Only (`expo/create-only/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.local.json` | create-only | Expo project paths and aliases |

**`tsconfig.local.json`**:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

#### NestJS Stack (`nestjs/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.nestjs.json` | copy-overwrite | NestJS stack settings |
| `tsconfig.json` | copy-overwrite | Entry point |
| `tsconfig.build.json` | copy-overwrite | Build config (excludes tests) |
| `tsconfig.spec.json` | copy-overwrite | Test config |

**`tsconfig.nestjs.json`**:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": ".build",
    "baseUrl": "./"
  }
}
```

**`tsconfig.build.json`**:
```json
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.spec.ts"]
}
```

**`tsconfig.spec.json`**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["**/*.spec.ts", "**/*.d.ts"]
}
```

#### NestJS Create-Only (`nestjs/create-only/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.local.json` | create-only | NestJS project paths |

#### CDK Stack (`cdk/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.cdk.json` | copy-overwrite | CDK stack settings |
| `tsconfig.json` | copy-overwrite | Entry point |

**`tsconfig.cdk.json`**:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

#### CDK Create-Only (`cdk/create-only/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `tsconfig.local.json` | create-only | CDK project includes/excludes |

---

### Jest Files

#### Shared Base (`typescript/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `jest.base.ts` | copy-overwrite | Shared helpers: mergeThresholds, mergeConfigs, defaults |
| `jest.typescript.ts` | copy-overwrite | TypeScript/Node jest config factory |
| `jest.config.ts` | copy-overwrite | Entry point for typescript stack |

**`jest.base.ts`** exports:
- `defaultThresholds` - default coverage thresholds (70/70/70/70)
- `defaultCoverageExclusions` - patterns to exclude from coverage
- `mergeThresholds(defaults, overrides)` - merge coverage thresholds
- `mergeConfigs(...configs)` - merge Jest configs (arrays concatenate, objects shallow-merge)

**`jest.typescript.ts`** exports:
- Re-exports from `jest.base.ts`
- `getTypescriptJestConfig(options)` - factory returning Config for node/ts-jest projects

**`jest.config.ts`** (entry point):
```typescript
import { mergeConfigs } from "./jest.base";
import { defaultThresholds, getTypescriptJestConfig, mergeThresholds } from "./jest.typescript";
import thresholdsOverrides from "./jest.thresholds.json" with { type: "json" };
import localConfig from "./jest.config.local";

const thresholds = mergeThresholds(defaultThresholds, thresholdsOverrides);
export default mergeConfigs(getTypescriptJestConfig({ thresholds }), localConfig);
```

#### Shared Create-Only (`typescript/create-only/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `jest.config.local.ts` | create-only | Project-specific jest overrides |
| `jest.thresholds.json` | create-only | Coverage threshold overrides |

**`jest.thresholds.json`**:
```json
{
  "global": {
    "statements": 70,
    "branches": 70,
    "functions": 70,
    "lines": 70
  }
}
```

#### Expo Stack (`expo/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `jest.expo.ts` | copy-overwrite | Expo jest config factory |
| `jest.config.ts` | copy-overwrite | Entry point |

**`jest.expo.ts`** exports `getExpoJestConfig(options)`:
- `testEnvironment: "jsdom"`
- `transform`: babel-jest for JS/TS, react-native asset transformer for images
- `resolver`: react-native resolver
- `haste`: platform detection (ios, android, native)
- `transformIgnorePatterns`: React Native library exclusions

#### NestJS Stack (`nestjs/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `jest.nestjs.ts` | copy-overwrite | NestJS jest config factory |
| `jest.config.ts` | copy-overwrite | Entry point |

**`jest.nestjs.ts`** exports `getNestjsJestConfig(options)`:
- `testEnvironment: "node"`
- `rootDir: "src"`
- `testRegex: ".*\\.spec\\.ts$"`
- `transform`: ts-jest
- `moduleFileExtensions: ["js", "json", "ts"]`
- Extensive `collectCoverageFrom` exclusions (entities, DTOs, modules, migrations, etc.)

#### CDK Stack (`cdk/copy-overwrite/`)

| File | Strategy | Purpose |
|------|----------|---------|
| `jest.cdk.ts` | copy-overwrite | CDK jest config factory |
| `jest.config.ts` | copy-overwrite | Entry point |

**`jest.cdk.ts`** exports `getCdkJestConfig(options)`:
- `testEnvironment: "node"`
- `roots: ["<rootDir>/test"]`
- `testRegex: "(.*\\.(spec|integration-spec)\\.ts)$"`
- `transform`: ts-jest
- `collectCoverageFrom`: only `lib/` and `util/`

---

## What Goes Where

### TSConfig: Base vs Stack vs Local

| Setting | Base (governance) | Stack | Local (project) |
|---------|:-:|:-:|:-:|
| `strict: true` | ✓ | | |
| `skipLibCheck: true` | ✓ | | |
| `forceConsistentCasingInFileNames` | ✓ | | |
| `esModuleInterop` | ✓ | | |
| `resolveJsonModule` | ✓ | | |
| `target` | | ✓ | |
| `module` | | ✓ | |
| `moduleResolution` | | ✓ | |
| `jsx` | | ✓ (expo) | |
| `emitDecoratorMetadata` | | ✓ (nestjs) | |
| `experimentalDecorators` | | ✓ (nestjs, cdk) | |
| `paths` | | | ✓ |
| `include` / `exclude` | | | ✓ |
| `outDir` / `rootDir` | | | ✓ |

### Jest: Base vs Stack vs Local

| Setting | Base | Stack | Local (project) |
|---------|:-:|:-:|:-:|
| `testTimeout` | ✓ | | |
| `coverageThreshold` | ✓ (default) | | via `jest.thresholds.json` |
| `testEnvironment` | | ✓ | |
| `transform` | | ✓ | |
| `testMatch` / `testRegex` | | ✓ | ✓ (override) |
| `moduleNameMapper` | | | ✓ |
| `setupFiles` | | | ✓ |
| `collectCoverageFrom` | | ✓ (default) | ✓ (override) |

---

## Task List

Tasks are grouped by dependency. Parallel execution is noted.

### Group 1: Base Files (parallel)

1. Create `typescript/copy-overwrite/tsconfig.base.json`
2. Create `typescript/copy-overwrite/jest.base.ts`

### Group 2: Stack Configs (parallel, depends on Group 1)

3. Create `typescript/copy-overwrite/tsconfig.typescript.json`
4. Create `typescript/copy-overwrite/jest.typescript.ts`
5. Create `expo/copy-overwrite/tsconfig.expo.json`
6. Create `expo/copy-overwrite/jest.expo.ts`
7. Create `nestjs/copy-overwrite/tsconfig.nestjs.json`
8. Create `nestjs/copy-overwrite/jest.nestjs.ts`
9. Create `cdk/copy-overwrite/tsconfig.cdk.json`
10. Create `cdk/copy-overwrite/jest.cdk.ts`

### Group 3: Entry Points & Auxiliary (parallel, depends on Group 2)

11. Create `typescript/copy-overwrite/tsconfig.json` (entry point)
12. Create `typescript/copy-overwrite/jest.config.ts` (entry point)
13. Create `expo/copy-overwrite/tsconfig.json` (entry point)
14. Create `expo/copy-overwrite/jest.config.ts` (entry point)
15. Create `nestjs/copy-overwrite/tsconfig.json` (entry point)
16. Create `nestjs/copy-overwrite/jest.config.ts` (entry point)
17. Create `nestjs/copy-overwrite/tsconfig.build.json`
18. Create `nestjs/copy-overwrite/tsconfig.spec.json`
19. Create `cdk/copy-overwrite/tsconfig.json` (entry point)
20. Create `cdk/copy-overwrite/jest.config.ts` (entry point)

### Group 4: Create-Only Templates (parallel, no dependencies)

21. Create `typescript/create-only/tsconfig.local.json`
22. Create `typescript/create-only/jest.config.local.ts`
23. Create `typescript/create-only/jest.thresholds.json`
24. Create `expo/create-only/tsconfig.local.json`
25. Create `nestjs/create-only/tsconfig.local.json`
26. Create `cdk/create-only/tsconfig.local.json`

### Group 5: Dog-Food Lisa Itself (depends on Groups 1-4)

27. Update Lisa's own `tsconfig.json` to extend `tsconfig.typescript.json` + `tsconfig.local.json`
28. Create Lisa's own `tsconfig.local.json` with its specific settings (ES2022, NodeNext, exactOptionalPropertyTypes, etc.)
29. Update Lisa's own `jest.config.ts` to use the new pattern
30. Create Lisa's own `jest.config.local.ts` with ESM-specific settings
31. Create Lisa's own `jest.thresholds.json` with current thresholds (75/65/60/75)

### Group 6: Tests (depends on Group 5)

32. Write tests for `jest.base.ts` helpers (`mergeThresholds`, `mergeConfigs`)
33. Run `bun run typecheck` to verify tsconfig changes work
34. Run `bun test` to verify jest changes work
35. Run `bun run lint` to verify no lint violations

### Group 7: Documentation (depends on Group 6)

36. Update OVERVIEW.md with tsconfig and jest inheritance documentation

## Skills to Use During Execution

- `/jsdoc-best-practices` — for all new `.ts` file preambles
- `/git:commit` — atomic commits after each group

## Verification

```bash
# TypeScript compiles cleanly
bun run typecheck

# Tests pass with new jest config
bun test

# Lint passes
bun run lint

# Verify tsconfig extends chain works
npx tsc --showConfig | head -30

# Verify jest config resolves correctly
npx jest --showConfig 2>&1 | head -50
```

## Migration Notes

When Lisa runs on existing projects after this change:
- **copy-overwrite files** (`tsconfig.json`, `jest.config.ts`, etc.) will overwrite existing project files
- **create-only files** (`tsconfig.local.json`, `jest.config.local.ts`, `jest.thresholds.json`) will only be created if they don't exist
- Projects will need to move their project-specific tsconfig settings (paths, includes, outDir, rootDir) into `tsconfig.local.json`
- Projects will need to move their project-specific jest settings (moduleNameMapper, setupFiles, testMatch) into `jest.config.local.ts`
- Projects will need to move their coverage thresholds into `jest.thresholds.json`

## Critical Reference Files

- `typescript/copy-overwrite/eslint.base.ts` — pattern for `jest.base.ts`
- `typescript/copy-overwrite/eslint.typescript.ts` — pattern for `jest.typescript.ts`
- `expo/copy-overwrite/eslint.config.ts` — pattern for entry points
- `typescript/create-only/eslint.config.local.ts` — pattern for create-only templates
- `typescript/create-only/eslint.thresholds.json` — pattern for thresholds
