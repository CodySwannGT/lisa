# Plan: Apply Lisa tsconfig fix to acme-product-b

## Summary

Run Lisa against acme-product-b to apply the updated tsconfig templates (from `fix/tsconfig-local-override`), then update `tsconfig.local.json` with the correct `include`/`exclude` for the project's `lambdas/` and `lib/` directory layout.

## Problem

The acme-product-b project has no `src/` directory — its source code lives in `lambdas/` and `lib/`. A previous Lisa run staged changes that hardcode `include: ["src/**/*"]` in `tsconfig.json`, breaking the project. The fix from `fix/tsconfig-local-override` moves `include`/`exclude` to `tsconfig.typescript.json` so `tsconfig.local.json` can override them.

## Solution

1. Run `bun run dev ~/workspace/acmeorgb/acme-product-b` from Lisa to apply updated templates
2. Update `tsconfig.local.json` in acme-product-b to add `include`/`exclude` with the project's actual paths
3. Commit and push to the existing PR

## Branch

`chore/lisa-tooling-and-security-updates` (existing branch in acme-product-b)

## PR

Existing PR: https://github.com/acmeorgb/acme-product-b/pull/29

## Changes

### 1. Run Lisa

From `/Users/cody/workspace/lisa`, run:
```bash
bun run dev ~/workspace/acmeorgb/acme-product-b
```

This will apply the updated templates where `tsconfig.json` no longer has `include`/`exclude` and `tsconfig.typescript.json` has the defaults.

### 2. Update `tsconfig.local.json`

Add `include`/`exclude` to the existing `tsconfig.local.json` at `/Users/cody/workspace/acmeorgb/acme-product-b/tsconfig.local.json`:

```json
{
  "compilerOptions": {
    ...existing compilerOptions...
  },
  "include": ["lambdas/**/*", "lib/**/*"],
  "exclude": ["node_modules", "dist", ".build", "**/*.test.ts", "**/*.spec.ts"]
}
```

### 3. Commit and push

Commit the updated Lisa-managed files and the tsconfig.local.json override to the existing PR.

## Key files

- `/Users/cody/workspace/acmeorgb/acme-product-b/tsconfig.json` — managed by Lisa, will lose `include`/`exclude`
- `/Users/cody/workspace/acmeorgb/acme-product-b/tsconfig.typescript.json` — managed by Lisa, will gain default `include`/`exclude`
- `/Users/cody/workspace/acmeorgb/acme-product-b/tsconfig.eslint.json` — managed by Lisa, will use broad `**/*.ts`
- `/Users/cody/workspace/acmeorgb/acme-product-b/tsconfig.local.json` — create-only, needs `include`/`exclude` added

## Skills

- `/coding-philosophy`

## Verification

```bash
cd /Users/cody/workspace/acmeorgb/acme-product-b

# tsconfig.json should NOT have include/exclude
jq 'has("include")' tsconfig.json  # false

# tsconfig.typescript.json should have default include
jq '.include' tsconfig.typescript.json  # ["src/**/*"]

# tsconfig.local.json should have project-specific include
jq '.include' tsconfig.local.json  # ["lambdas/**/*", "lib/**/*"]

# tsconfig.eslint.json should have broad pattern
jq '.include' tsconfig.eslint.json  # ["**/*.ts"]

# Typecheck should pass (if project deps are installed)
bun run typecheck
```

## Task list (trivial changes — skip code review/simplification tasks)

Create tasks with TaskCreate:

1. Run Lisa against acme-product-b (`bun run dev ~/workspace/acmeorgb/acme-product-b`)
2. Update `tsconfig.local.json` with project-specific `include`/`exclude`
3. Verify typecheck passes
4. Commit and push to existing PR #29
5. Archive plan:
   - Create folder `apply-tsconfig-fix-acme-product-b` in `./plans/completed`
   - Rename this plan to match contents
   - Move into `./plans/completed/apply-tsconfig-fix-acme-product-b`
   - Read session IDs from the plan
   - Move `~/.claude/tasks/<session-id>` directories to `./plans/completed/apply-tsconfig-fix-acme-product-b/tasks`
   - Update any "in_progress" tasks to "completed"
   - Commit and push

## Sessions
