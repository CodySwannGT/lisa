# Lisa as an Installable devDependency

## Context

Currently Lisa works by physically copying ~50+ files into each host project (ESLint configs, Jest configs, tsconfigs, GitHub workflows, `.claude/` directory, `CLAUDE.md`, etc.) and forcing ~30+ devDependencies into host `package.json` via `package.lisa.json`. When Lisa releases a new version, host projects must run `npx @codyswann/lisa@latest .` to re-copy all those files.

The goal: make `@codyswann/lisa` a plain `devDependency` that host projects install normally. Lisa's tooling (eslint, jest, typescript, prettier, etc.) becomes Lisa's own `dependencies` — installed automatically via bun's hoisting. Host projects only need to run `bun update @codyswann/lisa` to get updated tools and config.

**Important constraint**: Some things genuinely cannot be made importable and must remain file copies:
- `.github/workflows/` — GitHub Actions reads only local files
- `.husky/` hooks — Husky reads only local shell scripts
- `.claude/` directory and `CLAUDE.md` — Claude Code reads only local files
- `.gitignore`, `.prettierignore`, `.yamllint`, `.gitleaksignore`, `knip.json`, `commitlint.config.cjs`, `ast-grep/`, `.safety-net.json` — tooling requires local files

**What changes**: The config files that tools *can* load from a package (ESLint, Jest, tsconfig) become thin wrapper files that import factory functions from `@codyswann/lisa`. The 30+ forced devDependencies collapse to a single forced devDependency: `@codyswann/lisa` itself.

---

## Architecture Overview

**Before:**
```
Host project
├── package.json         ← 30+ forced devDeps (eslint, jest, typescript, ...)
├── eslint.config.ts     ← full config, copied by Lisa
├── eslint.typescript.ts ← full config, copied by Lisa
├── eslint.base.ts       ← full config, copied by Lisa
├── jest.config.ts       ← full config, copied by Lisa
├── jest.typescript.ts   ← full config, copied by Lisa
├── tsconfig.json        ← full config, copied by Lisa
└── node_modules/
    ├── eslint/          ← installed from host package.json
    ├── jest/            ← installed from host package.json
    └── typescript/      ← installed from host package.json
```

**After:**
```
Host project
├── package.json         ← only "@codyswann/lisa" as devDep
├── eslint.config.ts     ← thin wrapper: imports from @codyswann/lisa
├── jest.config.ts       ← thin wrapper: imports from @codyswann/lisa
├── tsconfig.json        ← extends: "@codyswann/lisa/tsconfig/typescript"
└── node_modules/
    ├── @codyswann/lisa/ ← the one dep
    └── eslint/          ← hoisted from lisa's deps by bun
    └── jest/            ← hoisted from lisa's deps by bun
    └── typescript/      ← hoisted from lisa's deps by bun
```

---

## Implementation Plan

### Step 1: Create `src/configs/` — publishable factory functions

Create a new source tree that gets compiled into `dist/configs/`. These are adapted versions of the existing root-level config files, refactored to be importable factory functions.

**Files to create:**

`src/configs/eslint/base.ts`
- Adapted from `eslint.base.ts` (root level)
- Cross-imports change from `./eslint.base` to `./base`
- Exports: `getBaseConfigs`, `defaultIgnores`, all existing exports

`src/configs/eslint/typescript.ts`
- Adapted from `eslint.typescript.ts` (root level)
- Imports from `./base` instead of `./eslint.base`
- Exports: `getTypescriptConfig`, `defaultThresholds`, `defaultIgnores`

`src/configs/eslint/nestjs.ts`, `expo.ts`, `cdk.ts`
- Adapted from the `nestjs/copy-overwrite/eslint.nestjs.ts` etc.
- Each imports from `./typescript`

`src/configs/eslint/slow.ts`
- Adapted from `eslint.slow.config.ts` (root)
- Parameterized: accepts `ignorePatterns` arg instead of importing local JSON directly
  ```typescript
  export function getSlowConfig({ ignorePatterns = [] }: { ignorePatterns?: string[] } = {})
  ```

`src/configs/eslint/index.ts` — barrel re-exports all

`src/configs/jest/base.ts`, `typescript.ts`, `nestjs.ts`, `expo.ts`, `cdk.ts`, `index.ts`
- Same pattern, adapted from `jest.base.ts`, `jest.typescript.ts`, etc.

> The root-level `eslint.base.ts`, `eslint.typescript.ts` etc. are Lisa's own linting config for linting Lisa's source code. They stay as-is (Lisa uses them directly). `src/configs/` is the published tree for host projects.

---

### Step 2: Add `tsconfig/` directory at Lisa root

These are the canonical tsconfig JSON files published in the npm package (not compiled — raw JSON):

```
tsconfig/
  base.json         ← content of typescript/copy-overwrite/tsconfig.base.json
  typescript.json   ← content of typescript/copy-overwrite/tsconfig.typescript.json
  nestjs.json       ← content of nestjs/copy-overwrite/tsconfig.nestjs.json
  expo.json         ← content of expo/copy-overwrite/tsconfig.expo.json
  cdk.json          ← content of cdk/copy-overwrite/tsconfig.cdk.json
  eslint.json       ← content of typescript/copy-overwrite/tsconfig.eslint.json
  build.json        ← content of typescript/copy-overwrite/tsconfig.build.json
  spec.json         ← content of typescript/copy-overwrite/tsconfig.spec.json
```

---

### Step 3: Update Lisa's `package.json` — exports + deps

**Add `exports` map:**
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./eslint": "./dist/configs/eslint/index.js",
    "./eslint/base": "./dist/configs/eslint/base.js",
    "./eslint/typescript": "./dist/configs/eslint/typescript.js",
    "./eslint/nestjs": "./dist/configs/eslint/nestjs.js",
    "./eslint/expo": "./dist/configs/eslint/expo.js",
    "./eslint/cdk": "./dist/configs/eslint/cdk.js",
    "./eslint/slow": "./dist/configs/eslint/slow.js",
    "./jest": "./dist/configs/jest/index.js",
    "./jest/base": "./dist/configs/jest/base.js",
    "./jest/typescript": "./dist/configs/jest/typescript.js",
    "./jest/nestjs": "./dist/configs/jest/nestjs.js",
    "./jest/expo": "./dist/configs/jest/expo.js",
    "./jest/cdk": "./dist/configs/jest/cdk.js",
    "./tsconfig/base": "./tsconfig/base.json",
    "./tsconfig/typescript": "./tsconfig/typescript.json",
    "./tsconfig/nestjs": "./tsconfig/nestjs.json",
    "./tsconfig/expo": "./tsconfig/expo.json",
    "./tsconfig/cdk": "./tsconfig/cdk.json",
    "./tsconfig/eslint": "./tsconfig/eslint.json",
    "./tsconfig/build": "./tsconfig/build.json",
    "./tsconfig/spec": "./tsconfig/spec.json"
  }
}
```

**Update `files` array** — add `"tsconfig"`:
```json
"files": ["dist", "all", "typescript", "expo", "nestjs", "cdk", "rails", "tsconfig"]
```

**Move tooling from `devDependencies` to `dependencies`** (so bun hoists them into host projects):
```
eslint, typescript, typescript-eslint, jest, ts-jest,
prettier, @eslint/js, @eslint/eslintrc,
@eslint-community/eslint-plugin-eslint-comments,
eslint-plugin-functional, eslint-plugin-jsdoc, eslint-plugin-prettier,
eslint-plugin-sonarjs, @codyswann/eslint-plugin-code-organization,
eslint-import-resolver-typescript, eslint-plugin-import, eslint-config-prettier,
@jest/globals, @jest/test-sequencer, @types/jest,
jiti, tsx, husky, lint-staged,
@commitlint/cli, @commitlint/config-conventional,
knip, @ast-grep/cli, esbuild-register, jscodeshift,
standard-version, ts-morph,
@types/node, @types/fs-extra, @types/lodash.merge,
globals (already used by eslint.base.ts)
```

> Note: Moving packages from `devDependencies` to `dependencies` in Lisa is safe — npm/bun installs both during development, and `dependencies` are what get installed in host projects.

---

### Step 4: Update `typescript/package-lisa/package.lisa.json`

Replace the 30+ forced `devDependencies` with a single entry:

```json
{
  "force": {
    "devDependencies": {
      "@codyswann/lisa": "^1.49.0"
    }
  }
}
```

All the individual tools (`eslint`, `jest`, `typescript`, etc.) are removed from force — they arrive via bun hoisting from Lisa's `dependencies`. Scripts (`lint`, `test`, etc.) remain in force since bun hoisting puts the tools in `node_modules/.bin`.

Repeat for `nestjs/package-lisa/package.lisa.json`, `expo/package-lisa/package.lisa.json`, `cdk/package-lisa/package.lisa.json`.

---

### Step 5: Update thin wrapper templates deployed to host projects

Replace the full-config templates with thin wrappers that import from the package.

**`typescript/copy-overwrite/eslint.config.ts`** becomes:
```typescript
/**
 * ESLint 9 Flat Config
 *
 * Thin wrapper around @codyswann/lisa eslint config factory.
 * Customize via eslint.config.local.ts and eslint.thresholds.json.
 */
import path from "path";
import { fileURLToPath } from "url";
import { getTypescriptConfig, defaultIgnores, defaultThresholds } from "@codyswann/lisa/eslint/typescript";
import ignoreConfig from "./eslint.ignore.config.json" with { type: "json" };
import thresholdsConfig from "./eslint.thresholds.json" with { type: "json" };
import localConfig from "./eslint.config.local";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  ...getTypescriptConfig({
    tsconfigRootDir: __dirname,
    ignorePatterns: ignoreConfig.ignores || defaultIgnores,
    thresholds: { ...defaultThresholds, ...thresholdsConfig },
  }),
  ...localConfig,
];
```

**`typescript/copy-overwrite/jest.config.ts`** becomes:
```typescript
/**
 * Jest Configuration
 *
 * Thin wrapper around @codyswann/lisa jest config factory.
 * Customize via jest.config.local.ts and jest.thresholds.json.
 *
 * @jest-config-loader esbuild-register
 */
import { mergeConfigs, mergeThresholds, defaultThresholds } from "@codyswann/lisa/jest/typescript";
import localConfig from "./jest.config.local.ts";
import thresholdsOverrides from "./jest.thresholds.json" with { type: "json" };

export default mergeConfigs(
  { coverageThreshold: mergeThresholds(defaultThresholds, thresholdsOverrides) },
  localConfig
);
```

**`typescript/copy-overwrite/tsconfig.json`** becomes:
```json
{
  "extends": ["@codyswann/lisa/tsconfig/typescript", "./tsconfig.local.json"]
}
```

**`typescript/copy-overwrite/eslint.slow.config.ts`** becomes a thin wrapper calling `getSlowConfig({ ignorePatterns })`.

Repeat thin wrapper treatment for NestJS, Expo, CDK stacks using their respective subpath exports (`@codyswann/lisa/eslint/nestjs`, etc.).

---

### Step 6: Add deletions for now-redundant files in host projects

**`all/deletions.json`** (applies to every project type):
```json
{
  "paths": [".coderabbit.yml"]
}
```

**`typescript/deletions.json`** — add these paths (Lisa will delete them from host projects on next `lisa:update`):

```json
{
  "paths": [
    "eslint.base.ts",
    "eslint.typescript.ts",
    "jest.base.ts",
    "jest.typescript.ts",
    "tsconfig.base.json",
    "tsconfig.typescript.json"
  ]
}
```

Also delete `all/copy-overwrite/.coderabbit.yml` from the Lisa repo.

For NestJS, Expo, CDK — add their stack-specific config files to respective `deletions.json`.

---

### Step 7: Update Lisa's own configs (dogfooding — separate follow-up PR)

After Lisa is published with the new exports, update Lisa's own root-level `eslint.config.ts` and `jest.config.ts` to import from `@codyswann/lisa` itself. This confirms the exports work end-to-end but requires publishing first, so it goes in a follow-up PR.

---

## Files to Modify / Create

| Action | File |
|---|---|
| Create (x13) | `src/configs/eslint/{base,typescript,nestjs,expo,cdk,slow,index}.ts` + `src/configs/jest/{base,typescript,nestjs,expo,cdk,index}.ts` |
| Create (x8) | `tsconfig/{base,typescript,nestjs,expo,cdk,eslint,build,spec}.json` |
| Modify | `package.json` — exports map, files array, move deps |
| Modify | `typescript/package-lisa/package.lisa.json` |
| Modify | `nestjs/package-lisa/package.lisa.json` |
| Modify | `expo/package-lisa/package.lisa.json` |
| Modify | `cdk/package-lisa/package.lisa.json` |
| Modify | `typescript/copy-overwrite/eslint.config.ts` |
| Modify | `typescript/copy-overwrite/jest.config.ts` |
| Modify | `typescript/copy-overwrite/tsconfig.json` |
| Modify | `typescript/copy-overwrite/eslint.slow.config.ts` |
| Modify | (same for nestjs/, expo/, cdk/ stack configs) |
| Modify/Create | `typescript/deletions.json` + stack variants |
| Delete | `all/copy-overwrite/.coderabbit.yml` |
| Delete | `all/create-only/scripts/setup-deploy-key.sh` |
| Modify/Create | `all/deletions.json` — add `.coderabbit.yml` and `scripts/setup-deploy-key.sh` |
| Modify | `package.json` — add `"scripts"` to `files`, add `"setup-deploy-key"` bin entry |
| Modify | `typescript/package-lisa/package.lisa.json` — add `"setup:deploy-key"` to force.scripts |

---

## Step 6b: Move `setup-deploy-key.sh` to a Lisa `bin` entry

The deploy key setup script is currently distributed as `all/create-only/scripts/setup-deploy-key.sh`. Since Lisa will be an installed devDependency, the script can live in Lisa's own `scripts/` and be exposed as an npm `bin` entry — no more need to copy it into host projects.

**Changes:**

1. **Delete** `all/create-only/scripts/setup-deploy-key.sh` from the Lisa template tree
2. **Add** `"scripts/setup-deploy-key.sh"` to `all/deletions.json` so it gets removed from existing host projects on next `lisa:update`
3. **Add** `"scripts"` to the `files` array in Lisa's `package.json` so `scripts/setup-deploy-key.sh` is published
4. **Add** a `bin` entry in Lisa's `package.json`:
   ```json
   "bin": {
     "lisa": "dist/index.js",
     "setup-deploy-key": "scripts/setup-deploy-key.sh"
   }
   ```
5. **Add** `"setup:deploy-key": "setup-deploy-key"` to the `force.scripts` section of `all/package-lisa/package.lisa.json` (or `typescript/package-lisa/package.lisa.json`) so host projects have a script entry pointing to the bin — which bun resolves from `node_modules/.bin/setup-deploy-key`

After this, host projects run `bun run setup:deploy-key` and it invokes the script from Lisa's installed location automatically.

---

## Manual Migration for Existing Projects

Because `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` are **create-only** files, `lisa:update` will not overwrite them. Existing projects set up before the packaged workflow references were introduced still have local `uses:` references and must be manually updated once.

### `ci.yml` — update `quality` job

Find this pattern (calling the local file):
```yaml
uses: ./.github/workflows/quality.yml
```

Replace with (calling the packaged workflow from the Lisa repo):
```yaml
uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
```

The full new `quality` job should match the current create-only template for your stack — see `typescript/create-only/.github/workflows/ci.yml` for the TypeScript version, `nestjs/create-only/` for NestJS, `expo/create-only/` for Expo.

### `deploy.yml` — update `release` job

Find this pattern:
```yaml
uses: ./.github/workflows/release.yml
```

Replace with:
```yaml
uses: CodySwannGT/lisa/.github/workflows/release.yml@main
```

The `deploy.yml` file also needs any `with:` inputs updated to match the current release.yml interface (check `nestjs/create-only/.github/workflows/deploy.yml` or `expo/create-only/.github/workflows/deploy.yml` for reference).

### What to include in the plan's deliverables

Add a **Migration Guide** section to the PR description / release notes that:
1. Lists which files need manual editing and why (create-only files Lisa won't overwrite)
2. Shows the exact before/after diffs for `ci.yml` and `deploy.yml`
3. Notes that the migration is a one-time change per project

---

## Verification

1. **Build compiles cleanly**: `bun run build` — `dist/configs/` appears with all factory files
2. **Lisa's own linting works**: `bun run lint` — should pass (Lisa uses its root-level ESLint config unchanged)
3. **Lisa's own tests pass**: `bun run test`
4. **Export resolution**: In a test project, `import { getTypescriptConfig } from '@codyswann/lisa/eslint/typescript'` resolves correctly after `bun add @codyswann/lisa`
5. **tsconfig extend**: `"extends": "@codyswann/lisa/tsconfig/typescript"` resolves in a test project
6. **Tool hoisting**: After `bun add @codyswann/lisa`, verify `node_modules/.bin/eslint`, `node_modules/.bin/jest`, `node_modules/.bin/tsc` exist in the host project
7. **Integration test**: Run `/lisa:integration-test` against a downstream TypeScript project to verify it builds, lints, and tests correctly after the update
