# Fix: tsconfig.eslint.json missing jest.*.ts include pattern

## Problem

After the jest/typescript config consolidation (PR #135), Lisa copies `jest.base.ts`, `jest.typescript.ts`, and `jest.cdk.ts` to target projects. These files use ES module syntax (`import`/`export`).

Two issues arise in target projects (observed in `propswap/infrastructure`):

1. **ESLint error**: `jest.typescript.ts` (and `jest.base.ts`, `jest.cdk.ts`) are not included in `tsconfig.eslint.json`'s `include` array. The `*.config.ts` glob matches `jest.config.ts` but NOT `jest.base.ts` or `jest.typescript.ts`.
2. **Node warning**: `MODULE_TYPELESS_PACKAGE_JSON` - `jest.base.ts` uses ES module syntax but `package.json` lacks `"type": "module"`. This is cosmetic (tests still pass) and project-specific (CDK projects may not safely add `"type": "module"`).

## Root Cause

The `tsconfig.eslint.json` templates include `"*.config.ts"` and `"eslint.*.ts"` but not `"jest.*.ts"`. When the jest governance files were added, the tsconfig.eslint.json templates were not updated to match.

## Fix

Add `"jest.*.ts"` to the `include` array of every `tsconfig.eslint.json` that currently uses explicit glob patterns.

### Files to modify

| File | Current include | Change |
|------|----------------|--------|
| `typescript/copy-overwrite/tsconfig.eslint.json` | `["src/**/*", "tests/**/*", "test/**/*", "*.config.ts", "eslint.*.ts"]` | Add `"jest.*.ts"` |
| `cdk/copy-overwrite/tsconfig.eslint.json` | `["lib/**/*", "bin/**/*", "test/**/*", "*.config.ts", "eslint.*.ts"]` | Add `"jest.*.ts"` |
| `tsconfig.eslint.json` (Lisa's own) | `["src/**/*", "tests/**/*", "test/**/*", "*.config.ts", "eslint.*.ts"]` | Add `"jest.*.ts"` |

**No change needed:**
- `expo/copy-overwrite/tsconfig.eslint.json` - already uses `"**/*.ts"` which covers all `.ts` files
- `nestjs` - no `tsconfig.eslint.json` template exists

### Node MODULE_TYPELESS_PACKAGE_JSON warning

This is a separate, project-specific issue. The CDK `package.lisa.json` does not govern `"type": "module"` and adding it to CDK projects could break CDK tooling. This warning is cosmetic — tests run fine. No Lisa change needed for this.

## Tasks (subagents should run in parallel where possible)

1. Add `"jest.*.ts"` to `typescript/copy-overwrite/tsconfig.eslint.json` include array
2. Add `"jest.*.ts"` to `cdk/copy-overwrite/tsconfig.eslint.json` include array
3. Add `"jest.*.ts"` to root `tsconfig.eslint.json` include array
4. Run `bun run lint` to verify Lisa itself passes
5. Run `bun run test` to verify tests pass
6. Re-run Lisa on `propswap/infrastructure` and verify `bun run lint` passes there
7. Commit changes using `git:commit` skill

## Verification

```bash
# In Lisa repo
bun run lint
bun run test

# In target project after re-running lisa
cd ~/workspace/propswap/infrastructure
bun run lint
bun run test:unit
```

## Skills to use during execution

- `git:commit` for committing changes
