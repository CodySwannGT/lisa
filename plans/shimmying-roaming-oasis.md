# Fix tsconfig include/exclude + Lisa dependency placement

## Context

Two issues discovered during the batch project update:

1. **tsconfig include/exclude broken**: TypeScript resolves `include`/`exclude` paths relative to the config file they appear in. Lisa's published tsconfigs in `node_modules/@codyswann/lisa/tsconfig/` resolve relative to `node_modules/`, not the project root — making them broken.

2. **Lisa in dependencies instead of devDependencies**: Some projects have `@codyswann/lisa` in `dependencies` instead of `devDependencies`. The `lisa-update-projects` skill should fix this during updates.

## Part 1: tsconfig include/exclude

Remove `include`/`exclude` from published tsconfigs (keep compilerOptions only). Add them to copy-overwrite `tsconfig.json` templates at the project root.

### 1a. Published tsconfigs — remove include/exclude (7 files)

| File | Remove |
|------|--------|
| `tsconfig/typescript.json` | `include`, `exclude` |
| `tsconfig/nestjs.json` | `include`, `exclude` |
| `tsconfig/expo.json` | `include`, `exclude` |
| `tsconfig/cdk.json` | `include` |
| `tsconfig/eslint.json` | `include`, `exclude` |
| `tsconfig/build.json` | `exclude` |
| `tsconfig/spec.json` | `include` |

### 1b. Copy-overwrite tsconfig.json — add include/exclude (4 files)

**`typescript/copy-overwrite/tsconfig.json`**
```json
{
  "extends": ["@codyswann/lisa/tsconfig/typescript", "./tsconfig.local.json"],
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`nestjs/copy-overwrite/tsconfig.json`**
```json
{
  "extends": ["@codyswann/lisa/tsconfig/nestjs", "./tsconfig.local.json"],
  "include": ["src/**/*"],
  "exclude": ["node_modules", ".build", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

**`expo/copy-overwrite/tsconfig.json`**
```json
{
  "extends": ["@codyswann/lisa/tsconfig/expo", "./tsconfig.local.json"],
  "include": ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"],
  "exclude": ["node_modules", "dist", "web-build", "components/ui"]
}
```

**`cdk/copy-overwrite/tsconfig.json`**
```json
{
  "extends": ["@codyswann/lisa/tsconfig/cdk", "./tsconfig.local.json"],
  "include": ["lib/**/*", "bin/**/*", "test/**/*"],
  "exclude": ["node_modules", "cdk.out"]
}
```

### 1c. CDK create-only — remove redundant include/exclude (1 file)

**`cdk/create-only/tsconfig.local.json`** → `{}`

Root tsconfig.json now specifies include/exclude, so tsconfig.local.json values are overridden.

## Part 2: Lisa dependency placement in update-projects skill

Add a step to `.claude/skills/lisa-update-projects/SKILL.md` between current steps 5 and 6:

> After updating, check if `@codyswann/lisa` appears in the project's `dependencies` (not `devDependencies`). If so, move it: remove from `dependencies` and ensure it's in `devDependencies`. Use `jq` to check and the package manager to reinstall correctly.

### Files to modify

- `.claude/skills/lisa-update-projects/SKILL.md` — add new step

## Verification

1. `bun run build` — Lisa compiles
2. `bun run typecheck` — tsc --noEmit passes
3. `bun run test` — all tests pass
4. `bun run lint` — linting works
