# Fix: Add `allowImportingTsExtensions` to tsconfig.eslint.json

## Problem

Jest config files (`jest.config.ts`, `jest.expo.ts`, `jest.typescript.ts`, etc.) use `.ts` extensions in their imports (e.g., `import { mergeConfigs } from "./jest.base.ts"`). TypeScript 5.7 requires `allowImportingTsExtensions: true` in `compilerOptions` to permit `.ts` extensions, and this flag requires `noEmit: true` or `emitDeclarationOnly: true`.

The `tsconfig.eslint.json` files already have `noEmit: true` and include `jest.*.ts` in their `include` patterns (added in commit `7fd8f34`), but they're missing `allowImportingTsExtensions: true`, causing TS5097 errors.

## Fix

Add `"allowImportingTsExtensions": true` to `compilerOptions` in all `tsconfig.eslint.json` files. This is safe because they all already have `noEmit: true`.

## Files to Modify

1. **`tsconfig.eslint.json`** (Lisa root)
2. **`typescript/copy-overwrite/tsconfig.eslint.json`**
3. **`expo/copy-overwrite/tsconfig.eslint.json`**
4. **`cdk/copy-overwrite/tsconfig.eslint.json`**

### Change for each file

Add `"allowImportingTsExtensions": true` to the `compilerOptions` object alongside the existing `noEmit: true`.

For files 1, 2 (identical structure):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "tests/**/*", "test/**/*", "*.config.ts", "eslint.*.ts", "jest.*.ts"],
  "exclude": ["node_modules", "dist", "build"]
}
```

For file 3 (expo - different include/exclude):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": [
    "app/**/*",
    "components/**/*",
    "hooks/**/*",
    "lib/**/*",
    "features/**/*",
    "providers/**/*",
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "build",
    ".expo",
    "ios",
    "android"
  ]
}
```

For file 4 (cdk):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true
  },
  "include": ["lib/**/*", "bin/**/*", "test/**/*", "*.config.ts", "eslint.*.ts", "jest.*.ts"],
  "exclude": ["node_modules", "dist", "cdk.out"]
}
```

5. **`nestjs/copy-overwrite/tsconfig.eslint.json`** (NEW - create)

NestJS uses `module: "commonjs"` and doesn't set moduleResolution explicitly. The new file should follow the same pattern as other stacks, extending the NestJS tsconfig with `noEmit` and `allowImportingTsExtensions`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*", "*.config.ts", "eslint.*.ts", "jest.*.ts"],
  "exclude": ["node_modules", ".build"]
}
```

## Skills to Use During Execution

- `/jsdoc-best-practices` - if any JSDoc is written/reviewed
- `/git:commit` - for atomic conventional commit

## Verification

```bash
# 1. Run typecheck to ensure no regressions
bun run typecheck

# 2. Run linting to verify eslint can parse jest files
bun run lint

# 3. Run tests
bun run test

# 4. Verify the specific fix empirically - typecheck with tsconfig.eslint.json
npx tsc --project tsconfig.eslint.json --noEmit
```
