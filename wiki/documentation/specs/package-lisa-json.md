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
- **remove**: Keys Lisa deletes from a section (retired/renamed keys, e.g. the
  `knip` script renamed to `knip:check`)
- **adopt**: Values Lisa itself previously wrote into a key it has since handed
  back to the host, so `defaults` can refresh an uncustomised one

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
  },
  "remove": {
    "scripts": ["knip"]
  },
  "adopt": {
    "scripts": { "lint": ["eslint . --quiet"] }
  }
}
```

### Inheritance Chain

Templates inherit and merge up the chain:

```
all/package-lisa/package.lisa.json
└── typescript/package-lisa/package.lisa.json
    ├── expo/package-lisa/package.lisa.json
    ├── nestjs/package-lisa/package.lisa.json
    ├── npm-package/package-lisa/package.lisa.json
    └── cdk/package-lisa/package.lisa.json
```

**Merge rules for inheritance:**
- `force`: Child values override parent values (deep merge, child wins)
- `defaults`: Child values override parent values (deep merge, child wins)
- `merge`: Arrays are concatenated and deduplicated
- `remove`: Key lists are concatenated across the chain
- `adopt`: Per-key value lists are UNIONed across the chain — every layer's
  Lisa-authored values stay recognised

### Application Logic

When Lisa applies `package.lisa.json` to a project:

1. **Collect templates** - Gather all `package.lisa.json` files from detected types (e.g., `all` + `typescript` + `expo`)
2. **Merge templates** - Combine into single force/defaults/merge/remove structure
3. **Read project's package.json** - Parse current state
4. **Apply force** - Deep merge, Lisa's values win
4b. **Apply adopt** - Drop any key still holding a value Lisa itself wrote, so
   step 5 can install the current one. A value Lisa does not recognise is the
   host's own and is kept.
5. **Apply defaults** - Deep merge, project's values win (only set if missing)
6. **Apply merge** - Concatenate arrays, deduplicate
7. **Apply remove** - Delete retired keys from their sections (runs last so an
   earlier phase cannot reintroduce a removed key)
8. **Write package.json** - Output clean JSON with no Lisa metadata

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

#### Task 2.1: all/package-lisa/package.lisa.json

Base template applied to all projects:
- `force.scripts`: lint, test, build, format, typecheck
- `force.devDependencies`: eslint, prettier, husky, lint-staged, commitlint
- `merge.trustedDependencies`: base trusted deps

#### Task 2.2: typescript/package-lisa/package.lisa.json

TypeScript-specific additions:
- `force.devDependencies`: typescript, typescript-eslint, @types/node
- `force.scripts`: typecheck
- `defaults.engines`: node version

#### Task 2.3: expo/package-lisa/package.lisa.json

Expo-specific additions:
- `force.devDependencies`: expo-specific eslint plugins
- Any expo-specific scripts

#### Task 2.4: nestjs/package-lisa/package.lisa.json

NestJS-specific additions:
- `force.devDependencies`: @nestjs/testing, etc.
- `force.scripts`: NestJS-specific scripts

#### Task 2.5: npm-package/package-lisa/package.lisa.json

npm package-specific additions:
- `force.scripts`: prepublishOnly, publish-related
- `defaults.files`: dist directory

#### Task 2.6: cdk/package-lisa/package.lisa.json

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
- `all/package-lisa/package.lisa.json`
- `typescript/package-lisa/package.lisa.json`
- `expo/package-lisa/package.lisa.json`
- `nestjs/package-lisa/package.lisa.json`
- `npm-package/package-lisa/package.lisa.json`
- `cdk/package-lisa/package.lisa.json`

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

## The `@codyswann/lisa` pin belongs to the apply

No template states a version for Lisa itself, and
`tests/unit/config/lisa-pin-is-not-templated.test.ts` fails any that tries.

The reason is that an apply writes templates which **call into the package's own
API** — `eslint.config.ts` imports from `@codyswann/lisa`. The applied version
and the installed version are therefore two halves of one thing. While the pin
sat in a template it was a literal that could not know which version was
applying: the templates shipped `^2.106.0` throughout the 3.x line, a range that
does not even admit the version doing the applying.

When those halves drift, a config file calls an export the installed package
does not have and **every** run of the tool that loads it dies at config load —
lint, lint-staged, the pre-commit hook, CI Lint — while the apply itself reports
success. `postinstall`'s `tsc || true` swallows the only
local signal, so the failure surfaces at the next lint run, detached from the
apply that caused it, looking like a broken ESLint config rather than a version
skew. That is #2953.

So the apply owns the pin:

- it writes the **exact** applying version into whichever of `dependencies` or
  `devDependencies` the host already declares it in, adding it to
  `devDependencies` when the host has none;
- a **range** is rewritten as readily as an exact pin — a caret range admits the
  applying version without requiring it, so a lockfile still resolving an older
  build reproduces the skew exactly;
- a spec naming a **location** rather than a release (`file:`, `link:`,
  `portal:`, `workspace:`, a git URL) is left alone, because somebody is
  developing against a checkout — and the apply names both versions instead;
- the **postinstall** path (security pins only) does not touch the pin: the
  installed package is already the applying version, and rewriting a manifest
  from inside somebody's `install` is not that path's job;
- Lisa's own repository never gets a pin, because a package cannot depend on
  itself.

Every one of those outcomes is reported by name, so the operator is told to run
an install rather than discovering it at the next lint run.

## Reserved bases: governed gates a host can extend

Some governed scripts are **composition points**. CI invokes them through an
external reusable workflow, so a project that needs one more gate has nowhere to
put it except the script itself:

```
lint = <Lisa's checks> && <the project's own checks>
```

While those names sat in `force`, every apply deleted the project's half. The
loss was silent and the CI check stayed green, because the check runs
`<pm> run lint` and `lint` still existed — it just no longer measured anything.
That is #2952.

Such a script is now shipped as a **pair**:

| Half | Section | Owner | Purpose |
| --- | --- | --- | --- |
| `lint:lisa` | `force` | Lisa | The governed checks. Cannot be deleted or weakened; every apply restores it. |
| `lint` | `defaults` + `adopt` | the host | The composition point CI runs. Lisa installs a delegation once and never overwrites it again. |

The default Lisa installs is `$npm_execpath run lint:lisa`, which resolves to
whichever package manager the project uses. A host extends it in place:

```json
{ "lint": "$npm_execpath run lint:lisa && node scripts/my-gate.mjs" }
```

`adopt` is what makes the handover safe in both directions. A host still sitting
on a value Lisa itself wrote is recognised as uncustomised and migrated onto the
delegation, so it keeps tracking the template; any other value is the host's own
and survives untouched.

The split currently covers the static-analysis gates — `lint`, `lint:slow`,
`typecheck`, `format:check`, `knip` / `knip:check`, `sg:scan` — the scripts whose
whole contract is "run checks and fail". Scripts that produce an artifact or
start something (`build`, `start:*`, `deploy:*`) stay forced; a host replacing
one of those is replacing the artifact, not adding a gate, and the apply now
names the replacement instead of performing it quietly.

Three obligations are enforced by `tests/unit/config/governed-script-composition-points.test.ts`:

1. the bare gate name is never forced again;
2. every reserved base has a default that actually invokes it;
3. every reserved base's current value appears in its `adopt` list — so changing
   a base value without extending the list fails the suite rather than warning
   every lagging host.
