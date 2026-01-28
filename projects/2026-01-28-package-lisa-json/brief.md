# Package.lisa.json Implementation Plan

## Problem Statement

Lisa's current `tagged-merge` strategy uses inline `//lisa-*` comment keys inside `package.json` objects (e.g., inside `devDependencies`). This causes two issues:

1. **Bun install fails** - Bun treats `//lisa-force-dev-dependencies` as an actual package name and tries to resolve it from npm registry
2. **Knip can't ignore them** - Knip's `ignoreDependencies` skips entries starting with `/` because they're not valid package names

## Solution

Replace inline `//lisa-*` tags with separate `package.lisa.json` template files that define:
- **force**: Keys Lisa always overwrites (project changes are discarded)
- **defaults**: Keys Lisa sets only if missing (project can override)
- **merge**: Arrays where Lisa's items are combined with project's items

The project's `package.json` remains 100% clean - no Lisa artifacts.

## New File Format

### Template: `package.lisa.json`

```json
{
  "force": {
    "devDependencies": {
      "eslint": "^9.0.0",
      "prettier": "^3.0.0"
    },
    "scripts": {
      "lint": "eslint . --quiet",
      "test": "jest"
    }
  },
  "defaults": {
    "engines": {
      "node": "22.x"
    }
  },
  "merge": {
    "trustedDependencies": ["@ast-grep/cli"]
  }
}
```

### Inheritance Chain

Templates inherit and merge up the chain:

```
all/tagged-merge/package.lisa.json
└── typescript/tagged-merge/package.lisa.json
    ├── expo/tagged-merge/package.lisa.json
    ├── nestjs/tagged-merge/package.lisa.json
    ├── npm-package/tagged-merge/package.lisa.json
    └── cdk/tagged-merge/package.lisa.json
```

**Merge rules for inheritance:**
- `force`: Child values override parent values (deep merge, child wins)
- `defaults`: Child values override parent values (deep merge, child wins)
- `merge`: Arrays are concatenated and deduplicated

### Application Logic

When Lisa applies `package.lisa.json` to a project:

1. **Collect templates** - Gather all `package.lisa.json` files from detected types (e.g., `all` + `typescript` + `expo`)
2. **Merge templates** - Combine into single force/defaults/merge structure
3. **Read project's package.json** - Parse current state
4. **Apply force** - Deep merge, Lisa's values win
5. **Apply defaults** - Deep merge, project's values win (only set if missing)
6. **Apply merge** - Concatenate arrays, deduplicate
7. **Write package.json** - Output clean JSON with no Lisa metadata

## Implementation Tasks

### Phase 1: Create New Strategy

#### Task 1.1: Define Types
File: `src/strategies/package-lisa-types.ts`

```typescript
interface PackageLisaTemplate {
  force?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  merge?: Record<string, unknown[]>;
}
```

#### Task 1.2: Implement Strategy
File: `src/strategies/package-lisa.ts`

- `loadPackageLisaTemplates(types: string[]): PackageLisaTemplate` - Load and merge templates from type hierarchy
- `applyPackageLisa(template: PackageLisaTemplate, target: object): object` - Apply template to project's package.json
- Deep merge utility that handles force/defaults/merge semantics

#### Task 1.3: Register Strategy
File: `src/strategies/index.ts`

- Add `package-lisa` to strategy registry
- Strategy applies to `package.lisa.json` source files targeting `package.json`

#### Task 1.4: Unit Tests
File: `tests/unit/strategies/package-lisa.test.ts`

Test cases:
- Force overwrites existing values
- Force adds new values
- Defaults only set when missing
- Defaults don't overwrite existing
- Merge concatenates arrays
- Merge deduplicates values
- Inheritance merges correctly (child overrides parent)
- Empty sections are handled
- Nested objects merge correctly

### Phase 2: Create Template Files

#### Task 2.1: all/tagged-merge/package.lisa.json

Base template applied to all projects:
- `force.scripts`: lint, test, build, format, typecheck
- `force.devDependencies`: eslint, prettier, husky, lint-staged, commitlint
- `merge.trustedDependencies`: base trusted deps

#### Task 2.2: typescript/tagged-merge/package.lisa.json

TypeScript-specific additions:
- `force.devDependencies`: typescript, typescript-eslint, @types/node
- `force.scripts`: typecheck
- `defaults.engines`: node version

#### Task 2.3: expo/tagged-merge/package.lisa.json

Expo-specific additions:
- `force.devDependencies`: expo-specific eslint plugins
- Any expo-specific scripts

#### Task 2.4: nestjs/tagged-merge/package.lisa.json

NestJS-specific additions:
- `force.devDependencies`: @nestjs/testing, etc.
- `force.scripts`: NestJS-specific scripts

#### Task 2.5: npm-package/tagged-merge/package.lisa.json

npm package-specific additions:
- `force.scripts`: prepublishOnly, publish-related
- `defaults.files`: dist directory

#### Task 2.6: cdk/tagged-merge/package.lisa.json

CDK-specific additions:
- `force.devDependencies`: aws-cdk, constructs
- `force.scripts`: cdk-specific scripts

### Phase 3: Migrate Existing Templates

#### Task 3.1: Extract Values from Current tagged-merge/package.json Files

For each type directory:
1. Read current `tagged-merge/package.json`
2. Parse `//lisa-force-*`, `//lisa-defaults-*`, `//lisa-merge-*` sections
3. Convert to `package.lisa.json` format
4. Validate no values are lost

#### Task 3.2: Remove Old tagged-merge/package.json Files

After migration is complete and tested:
1. Delete `tagged-merge/package.json` files that used inline tags
2. Update `.lisa-manifest` entries

### Phase 4: Update Core Logic

#### Task 4.1: Update Lisa Orchestrator
File: `src/core/lisa.ts`

- Detect `package.lisa.json` files in type directories
- Call new strategy for package.json application
- Remove old tagged-merge handling for package.json

#### Task 4.2: Update Manifest
File: `src/core/manifest.ts`

- Record `package-lisa:package.json` entries
- Handle uninstall for package-lisa strategy

#### Task 4.3: Integration Tests
File: `tests/integration/package-lisa.integration.test.ts`

- Full workflow: detect types → load templates → apply to project
- Verify inheritance chain works
- Verify project package.json is clean (no Lisa artifacts)
- Verify bun install works on result
- Verify knip works on result

### Phase 5: Update Documentation

#### Task 5.1: Update README.md

- Document new `package.lisa.json` format
- Update copy strategies table
- Add migration notes for existing users

#### Task 5.2: Update CLAUDE.md

- Remove references to `//lisa-*` tags in package.json
- Document new approach

### Phase 6: Cleanup

#### Task 6.1: Remove Old Tagged-Merge Code

- Remove `//lisa-*` parsing from tagged-merge strategy
- Keep tagged-merge for non-package.json files if still needed
- Or deprecate entirely if package.lisa.json covers all use cases

#### Task 6.2: Remove Knip Patch

- Delete `patches/knip@5.82.1.patch`
- Remove `patchedDependencies` from package.json
- Verify knip works without patch

#### Task 6.3: Clean Up knip.json

- Remove `"^//.+"` regex pattern from ignoreDependencies
- Run knip to verify no errors

## File Changes Summary

### New Files
- `src/strategies/package-lisa.ts`
- `src/strategies/package-lisa-types.ts`
- `tests/unit/strategies/package-lisa.test.ts`
- `tests/integration/package-lisa.integration.test.ts`
- `all/tagged-merge/package.lisa.json`
- `typescript/tagged-merge/package.lisa.json`
- `expo/tagged-merge/package.lisa.json`
- `nestjs/tagged-merge/package.lisa.json`
- `npm-package/tagged-merge/package.lisa.json`
- `cdk/tagged-merge/package.lisa.json`

### Modified Files
- `src/strategies/index.ts` - Register new strategy
- `src/core/lisa.ts` - Use new strategy for package.json
- `src/core/manifest.ts` - Track package-lisa entries
- `README.md` - Document new format
- `CLAUDE.md` - Update references
- `knip.json` - Remove workaround patterns
- `package.json` - Remove patchedDependencies

### Deleted Files
- `all/tagged-merge/package.json` (replaced by package.lisa.json)
- `typescript/tagged-merge/package.json` (replaced by package.lisa.json)
- `expo/tagged-merge/package.json` (replaced by package.lisa.json)
- `nestjs/tagged-merge/package.json` (replaced by package.lisa.json)
- `npm-package/tagged-merge/package.json` (replaced by package.lisa.json)
- `cdk/tagged-merge/package.json` (replaced by package.lisa.json)
- `patches/knip@5.82.1.patch`

## Verification

After implementation, verify:

1. `bun install` works without errors
2. `bun run knip` passes without needing to ignore `//lisa-*` patterns
3. Project's `package.json` has no Lisa artifacts
4. All forced dependencies are present
5. Default values are set when missing
6. Merged arrays contain both Lisa's and project's items
7. Inheritance chain applies correctly (all → typescript → specific)

## Rollback Plan

If issues arise:
1. Keep old `tagged-merge/package.json` files as backup during migration
2. Strategy registry can fall back to old tagged-merge if package.lisa.json not found
3. Revert by restoring old files and removing new strategy
