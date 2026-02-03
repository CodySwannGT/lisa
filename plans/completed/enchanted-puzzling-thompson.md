# Fix Knip Errors After Lisa Update (serve binary + @/graphql/graphql)

## Problem

Running `bun run knip` in propswap/frontend after Lisa update surfaces two issues:

1. **`serve` unlisted binary** — Lisa's new `zap-baseline.yml` uses `npx serve` but expo `knip.json` doesn't list it in `ignoreBinaries`
2. **125 unresolved `@/graphql/graphql` imports** — tsconfig path `@/*: ./*` resolves to `./graphql/graphql` which doesn't exist; actual file is `generated/graphql.ts`

## Changes

### 1. Lisa: Add `serve` to expo knip ignoreBinaries

**File**: `expo/copy-overwrite/knip.json`

Change line 56 from:
```json
"ignoreBinaries": ["audit", "ast-grep", "maestro", "eas", "source-map-explorer"],
```
To (alphabetically sorted):
```json
"ignoreBinaries": ["ast-grep", "audit", "eas", "maestro", "serve", "source-map-explorer"],
```

### 2. propswap/frontend: Add graphql path mapping to tsconfig.local.json

**File**: `/Users/cody/workspace/propswap/frontend/tsconfig.local.json`

Add `paths` with specific `@/graphql/*` → `./generated/*` mapping. Must re-declare `@/*` because tsconfig `paths` from extending configs replace (not merge):

```json
{
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@/graphql/*": ["./generated/*"],
      "@/*": ["./*"]
    }
  }
}
```

## Verification

1. `bun run test:unit` in Lisa — existing tests pass
2. `bun run typecheck` in propswap/frontend — passes
3. `bun run knip` in propswap/frontend — no `serve` or `@/graphql/graphql` errors

## Commits

1. **Lisa repo**: `fix: add serve to expo knip ignoreBinaries for ZAP workflow`
2. **propswap/frontend**: `fix: add graphql path mapping to tsconfig.local.json for knip resolution`
