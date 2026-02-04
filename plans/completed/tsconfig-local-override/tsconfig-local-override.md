# Plan: Fix tsconfig inheritance so local overrides managed defaults

## Summary

Move `include`/`exclude` from `tsconfig.json` into `tsconfig.{stack}.json` (both copy-overwrite) so that `tsconfig.local.json` (create-only, last in extends array) can override them. Defaults stay in managed files targeting `src/**/*`, but projects like ask-gemini can override with their own paths via the local config.

## Problem

Lisa's copy-overwrite `tsconfig.json` hardcodes `include: ["src/**/*"]`. Since it's the root config loaded by `tsc`, its `include` takes precedence over anything in the extended configs. Projects with different layouts (e.g., `lambdas/**/*`, `lib/**/*`) get broken every time Lisa runs, and `tsconfig.local.json` can't override because TypeScript gives precedence to the child config, not the parent.

## Solution

Move `include`/`exclude` from `tsconfig.json` down into `tsconfig.{stack}.json` (e.g., `tsconfig.typescript.json`). Since `tsconfig.json` extends `["./tsconfig.{stack}.json", "./tsconfig.local.json"]` and later entries override earlier ones, the local file can now override the defaults when needed. If the local doesn't specify `include`, the stack default is used.

For `tsconfig.eslint.json`, use the broad `**/*.ts` pattern since the linter needs all TypeScript files regardless of directory layout.

CDK's `tsconfig.json` already has no `include`/`exclude` — no changes needed there.

## Branch

`fix/tsconfig-local-override` (from `main`)

## PR

Targets `main`

## Changes

### 1. TypeScript stack

**`typescript/copy-overwrite/tsconfig.json`** — remove `include`/`exclude` (inherits from extends):
```json
{
  "extends": ["./tsconfig.typescript.json", "./tsconfig.local.json"]
}
```

**`typescript/copy-overwrite/tsconfig.typescript.json`** — add `include`/`exclude` (the defaults):
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { ... existing ... },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`typescript/copy-overwrite/tsconfig.eslint.json`** — use broad pattern:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { ... existing ... },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "build"]
}
```

No changes to `typescript/create-only/tsconfig.local.json` — it stays as-is. Projects that need custom paths add `include`/`exclude` to their local file.

### 2. NestJS stack

**`nestjs/copy-overwrite/tsconfig.json`** — remove `include`/`exclude`:
```json
{
  "extends": ["./tsconfig.nestjs.json", "./tsconfig.local.json"]
}
```

**`nestjs/copy-overwrite/tsconfig.nestjs.json`** — add `include`/`exclude`:
Add `"include": ["src/**/*"]` and `"exclude": ["node_modules", ".build", "dist", "**/*.test.ts", "**/*.spec.ts"]` to existing file.

**`nestjs/copy-overwrite/tsconfig.eslint.json`** — use broad pattern:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { ... existing ... },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", ".build", "dist"]
}
```

### 3. Expo stack

**`expo/copy-overwrite/tsconfig.json`** — remove `include`/`exclude`:
```json
{
  "extends": ["./tsconfig.expo.json", "./tsconfig.local.json"]
}
```

**`expo/copy-overwrite/tsconfig.expo.json`** — add `include`/`exclude`:
Add `"include": ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"]` and `"exclude": ["node_modules", "dist", "web-build"]` to existing file.

**`expo/copy-overwrite/tsconfig.eslint.json`** — use broad pattern:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { ... existing ... },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist", "build", ".expo", "ios", "android"]
}
```

### 4. CDK stack

`tsconfig.json` already has no `include`/`exclude` — no change needed.

**`cdk/copy-overwrite/tsconfig.eslint.json`** — use broad pattern:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { ... existing ... },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "cdk.out"]
}
```

### 5. Lisa's own tsconfig files

Apply same pattern to Lisa's root configs:
- `tsconfig.json` — remove `include`/`exclude`
- `tsconfig.typescript.json` — already has compiler options, add `include`/`exclude`
- `tsconfig.local.json` — already correct
- `tsconfig.eslint.json` — use broad `**/*.ts` pattern

## Task list

Create tasks with TaskCreate:

1. Create branch `fix/tsconfig-local-override` from `main`
2. Update TypeScript stack templates (tsconfig.json, tsconfig.typescript.json, tsconfig.eslint.json)
3. Update NestJS stack templates (tsconfig.json, tsconfig.nestjs.json, tsconfig.eslint.json)
4. Update Expo stack templates (tsconfig.json, tsconfig.expo.json, tsconfig.eslint.json)
5. Update CDK stack tsconfig.eslint.json
6. Update Lisa's own tsconfig files
7. Run tests and verify (`bun run test`, `bun run lint`, `bun run typecheck`)
8. Commit and push
9. Create PR targeting `main`
10. CodeRabbit review
11. `/plan-local-code-review`
12. Implement valid review suggestions
13. Simplify with code simplifier agent
14. Update/add/remove tests
15. Update/add/remove documentation (JSDoc, markdown)
16. Verify all verification metadata in existing tasks
17. Archive plan

## Skills

- `/coding-philosophy`
- `/jsdoc-best-practices`

## Verification

```bash
# Lisa's own build passes
cd /Users/cody/workspace/lisa && bun run typecheck && bun run lint && bun run test

# Verify template content
jq 'has("include")' typescript/copy-overwrite/tsconfig.json  # false
jq '.include' typescript/copy-overwrite/tsconfig.typescript.json  # ["src/**/*"]
jq '.include' typescript/copy-overwrite/tsconfig.eslint.json  # ["**/*.ts"]
```

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 13ef5c1c-a441-4c1e-9a00-3862d4e95bd2 | 2026-02-04T01:04:30Z | implement |
| 98527791-9034-4deb-94d8-c2a7c9bb2b76 | 2026-02-04T02:42:54Z | plan |
| 2de6519d-e459-4fcf-9823-072de5b021ca | 2026-02-04T03:04:34Z | implement |
