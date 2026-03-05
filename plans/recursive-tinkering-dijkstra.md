# Fix: Move baseUrl/paths from published tsconfigs to copy-overwrite templates

## Context

When `tsconfig.json` extends `@codyswann/lisa/tsconfig/expo` from `node_modules`, TypeScript resolves `baseUrl: "./"` and `paths` relative to the config file's location (inside `node_modules/@codyswann/lisa/tsconfig/`), not the project root. This breaks all `@/*` path aliases, causing 219+ TypeScript errors in propswap/frontend (PR #455) and requiring manual overrides in `tsconfig.local.json`.

This affects **all** Expo and NestJS projects. The fix should be in Lisa templates, not local overrides.

## Root Cause

TypeScript resolves `baseUrl` relative to the config file where it is **defined**. Published tsconfigs live in `node_modules/`, so `baseUrl: "./"` = `node_modules/@codyswann/lisa/tsconfig/`.

## Changes

### 1. Remove `baseUrl` from `tsconfig/base.json`

Remove line 13. This is the root cause — inherited by all stacks.

### 2. Remove `baseUrl` and `paths` from `tsconfig/expo.json`

Remove `baseUrl: "./"` and `paths` block. Keep `moduleSuffixes`, `jsx`, `noEmit`, etc.

### 3. Remove `baseUrl` and `paths` from `tsconfig/nestjs.json`

Remove `baseUrl: "./"` and `paths` block. Keep `outDir: ".build"` (always overridden by `tsconfig.local.json`, separate concern).

### 4. Add `baseUrl` and `paths` to `expo/copy-overwrite/tsconfig.json`

```json
{
  "extends": ["@codyswann/lisa/tsconfig/expo", "./tsconfig.local.json"],
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@/graphql/*": ["./generated/*"],
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"],
  "exclude": ["node_modules", "dist", "web-build", "components/ui"]
}
```

This file lives at the project root after copy-overwrite, so `baseUrl: "./"` resolves correctly.

### 5. Add `baseUrl` and `paths` to `nestjs/copy-overwrite/tsconfig.json`

```json
{
  "extends": ["@codyswann/lisa/tsconfig/nestjs", "./tsconfig.local.json"],
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", ".build", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

### 6. Add `baseUrl` to `typescript/copy-overwrite/tsconfig.json`

```json
{
  "extends": ["@codyswann/lisa/tsconfig/typescript", "./tsconfig.local.json"],
  "compilerOptions": {
    "baseUrl": "./"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

No `paths` needed (typescript stack doesn't define aliases), but `baseUrl` ensures any project-added `paths` in `tsconfig.local.json` work correctly.

### 7. Add `baseUrl` to `cdk/copy-overwrite/tsconfig.json`

```json
{
  "extends": ["@codyswann/lisa/tsconfig/cdk", "./tsconfig.local.json"],
  "compilerOptions": {
    "baseUrl": "./"
  },
  "include": ["lib/**/*", "bin/**/*", "test/**/*"],
  "exclude": ["node_modules", "cdk.out"]
}
```

### Files NOT changed

- `expo/copy-overwrite/tsconfig.expo.json` — extends local files, already resolves correctly
- `nestjs/copy-overwrite/tsconfig.nestjs.json` — extends local files, already resolves correctly
- All `tsconfig.eslint.json` files — inherit from `./tsconfig.json`, will get correct `baseUrl` after fix
- `expo/create-only/tsconfig.local.json` — no changes needed (copy-overwrite handles it)
- No test changes needed — integration tests check file existence, not tsconfig content

## Critical Files

- `tsconfig/base.json` — remove `baseUrl`
- `tsconfig/expo.json` — remove `baseUrl`, `paths`
- `tsconfig/nestjs.json` — remove `baseUrl`, `paths`
- `expo/copy-overwrite/tsconfig.json` — add `baseUrl`, `paths`
- `nestjs/copy-overwrite/tsconfig.json` — add `baseUrl`, `paths`
- `typescript/copy-overwrite/tsconfig.json` — add `baseUrl`
- `cdk/copy-overwrite/tsconfig.json` — add `baseUrl`

## Verification

1. `bun run typecheck` — confirm Lisa itself still compiles
2. `bun run test` — confirm no test failures
3. `bun run lint` — confirm no lint errors
