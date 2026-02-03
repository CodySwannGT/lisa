# Fix: CDK synth TypeError by switching ts-node to tsx

## Problem

Lisa commit e05f018 changed `cdk/copy-overwrite/tsconfig.json` to use TypeScript 5.0 array extends:

```json
{ "extends": ["./tsconfig.cdk.json", "./tsconfig.local.json"] }
```

ts-node v10.x's `normalizeSlashes()` expects a string for `extends` but receives an array, causing:

```
TypeError: value.replace is not a function
```

## Root Cause

ts-node v10.x does not support TypeScript 5.0's array `extends` syntax in tsconfig.json. tsx (already a forced devDependency via root `package.lisa.json`) handles array extends natively.

## Fix

### 1. Add `cdk/create-only/cdk.json` template using tsx

Create a new template file at `cdk/create-only/cdk.json`:

```json
{
  "app": "npx tsx bin/infrastructure.ts",
  "watch": {
    "include": ["**"],
    "exclude": [
      "README.md",
      "cdk*.json",
      "**/*.d.ts",
      "**/*.js",
      "tsconfig.json",
      "package.json",
      "yarn.lock",
      "node_modules",
      "test"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"]
  }
}
```

**Why create-only (not copy-overwrite):** `cdk.json` contains project-specific context values (AWS account IDs, feature flags, custom context). copy-overwrite would destroy these. create-only ensures new CDK projects get the correct template while existing projects are not disrupted.

### 2. Update documentation

No separate documentation file changes needed — this is a template addition.

## Files to Create

| File | Type | Purpose |
|------|------|---------|
| `cdk/create-only/cdk.json` | New (create-only template) | CDK app config using tsx |

## Files Unchanged (verified)

| File | Reason |
|------|--------|
| `cdk/copy-overwrite/tsconfig.json` | Array extends stays as-is (correct TS 5.0 pattern) |
| `cdk/package-lisa/package.lisa.json` | tsx already provided by root package.lisa.json |
| `package.lisa.json` | Already forces tsx ^4.0.0 as devDependency |

## Existing Projects

Existing CDK projects must manually update their `cdk.json`:

```diff
- "app": "npx ts-node --prefer-ts-exts bin/infrastructure.ts"
+ "app": "npx tsx bin/infrastructure.ts"
```

This is the correct approach since Lisa's create-only strategy won't overwrite existing files.

## Skills to Use During Execution

- `/jsdoc-best-practices` — if any source code is modified (not applicable here, template-only change)
- `/git:commit` — for committing the change

## Verification

```bash
# 1. Verify the new template exists with correct content
cat cdk/create-only/cdk.json | jq '.app'
# Expected: "npx tsx bin/infrastructure.ts"

# 2. Verify tsx is available as a dependency in root package.lisa.json
cat package.lisa.json | jq '.force.devDependencies.tsx'
# Expected: "^4.0.0"

# 3. Run lint/typecheck to ensure no regressions
bun run lint && bun run typecheck
```
