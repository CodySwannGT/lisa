---
date: 2026-01-28
status: complete
last_updated: 2026-01-28
---

# Research: Package.Lisa.json Implementation

## Summary

The codebase is architected to support a new copy strategy (`package-lisa`) that will replace the current `tagged-merge` strategy's inline `//lisa-*` comment-based tags in `package.json` files. The implementation requires:

1. Creating a new `PackageLisaStrategy` class implementing `ICopyStrategy` interface
2. Adding the strategy to the `StrategyRegistry` in `src/strategies/index.ts`
3. Adding type definition to `CopyStrategy` union in `src/core/config.ts`
4. Creating `package.lisa.json` template files for each type hierarchy
5. Integration with existing deep merge utilities and manifest recording

The strategy will inherit operational patterns from existing strategies (`merge` and `tagged-merge`) and reuse core utilities (`deepMerge`, `readJson`, `writeJson`) from `src/utils/json-utils.ts`.

## Detailed Findings

### 1. Copy Strategy Architecture

**Location:** `src/strategies/` directory

#### ICopyStrategy Interface (`src/strategies/strategy.interface.ts:31-49`)

All strategies implement this contract:

```typescript
export interface ICopyStrategy {
  readonly name: CopyStrategy;

  apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult>;
}
```

**Implementation Requirements:**
- Must have `readonly name` property set to a literal string matching one of the `CopyStrategy` union types
- Must implement async `apply()` method that always returns `FileOperationResult`
- Must check `context.config.dryRun` before all file I/O operations
- Must call `context.recordFile()` after successful operations (for manifest tracking)
- Must call `context.backupFile()` before modifying existing files
- Should return appropriate action: `"copied"`, `"skipped"`, `"merged"`, etc.

**StrategyContext provides** (`src/strategies/strategy.interface.ts:10-26`):
- `config: LisaConfig` - Configuration with `dryRun`, `yesMode`, `destDir` flags
- `recordFile()` - Callback to record files in manifest for uninstall tracking
- `backupFile()` - Creates timestamped backup in `.lisabak/` before modifying files
- `promptOverwrite()` - User prompt callback (only used by copy-overwrite strategy)

#### FileOperationResult Type (`src/core/config.ts:84-95`)

```typescript
export interface FileOperationResult {
  readonly relativePath: string;
  readonly strategy: CopyStrategy;
  readonly action: "copied" | "skipped" | "overwritten" | "appended" | "merged" | "created";
  readonly linesAdded?: number;
}
```

For `package-lisa` strategy, should return action: `"merged"` (consistent with JSON merge strategies).

### 2. Strategy Registry and Registration

**Location:** `src/strategies/index.ts`

#### Registry Implementation (`lines 19-75`)

```typescript
export class StrategyRegistry {
  private readonly strategies: Map<CopyStrategy, ICopyStrategy>;

  constructor(strategies?: readonly ICopyStrategy[]) {
    const allStrategies = strategies ?? [
      new CopyOverwriteStrategy(),
      new CopyContentsStrategy(),
      new CreateOnlyStrategy(),
      new MergeStrategy(),
      new TaggedMergeStrategy(),
    ];
    this.strategies = new Map(allStrategies.map(s => [s.name, s]));
  }

  get(name: CopyStrategy): ICopyStrategy { /* ... */ }
  has(name: CopyStrategy): boolean { /* ... */ }
  getAll(): readonly ICopyStrategy[] { /* ... */ }
}
```

**Registration Pattern:**
1. Add `new PackageLisaStrategy()` to default strategies array in constructor
2. Must come AFTER `TaggedMergeStrategy` (line 32) to maintain strategy order consistency

#### Type Registration (`src/core/config.ts:4-9`)

```typescript
export type CopyStrategy =
  | "copy-overwrite"
  | "copy-contents"
  | "create-only"
  | "merge"
  | "tagged-merge";
```

**Required Change:** Add `| "package-lisa"` to union type.

#### Export Registration (`src/strategies/index.ts:7-14`)

Must add imports and exports:
```typescript
import { PackageLisaStrategy } from "./package-lisa.js";
export { PackageLisaStrategy } from "./package-lisa.js";
```

### 3. JSON Utilities and Deep Merge

**Location:** `src/utils/json-utils.ts`

#### deepMerge Function (`lines 73-76`)

```typescript
export function deepMerge<T extends object>(base: T, override: T): T {
  return merge({}, base, override) as T;
}
```

**Key Properties:**
- Uses `lodash.merge` (line 75)
- `override` parameter (Lisa values) takes precedence in conflicts
- `base` parameter (project values) serves as defaults
- Creates new object; doesn't mutate inputs
- Returns merged object cast to type T

**For package-lisa strategy:**
- `base` = project's current `package.json`
- `override` = merged Lisa template values from force/defaults/merge sections
- Result is final merged JSON written back

**Limitation:** Arrays merge by index, not value. This is acceptable for `package.json` since force/defaults override entire value sections.

#### readJson and writeJson Functions

**readJson** (`lines 10-20`): Reads and parses JSON file with error handling
- Returns typed object `Promise<T>`
- Throws `JsonParseError` on syntax errors
- Throws filesystem errors (ENOENT, EACCES) as-is

**writeJson** (`lines 43-50`): Serializes and writes JSON file
- Parameters: `filePath`, `data`, `spaces` (default: 2)
- Appends newline (POSIX convention)
- No custom error wrapping; filesystem errors pass through
- Requires parent directory to exist (use `ensureParentDir()` first)

**Both used by existing merge strategies** (`merge.ts:46-48, 53, 76`):
```typescript
const sourceJson = await readJson<Record<string, unknown>>(sourcePath);
const destJson = await readJson<Record<string, unknown>>(destPath);
const merged = deepMerge(destJson, sourceJson);
await writeJson(destPath, merged);
```

**Pattern for package-lisa strategy:**
- Read source `package.lisa.json` files via `readJson`
- Merge them per inheritance chain
- Read destination `package.json` via `readJson`
- Apply force/defaults/merge logic
- Write result via `writeJson`

### 4. Existing Tagged-Merge Strategy

**Location:** `src/strategies/tagged-merge.ts` (695 lines)

#### Core Concept

Implements JSON governance via comment-based tags:
- `//lisa-force-<category>` → `//end-lisa-force-<category>`: Lisa replaces section, project changes ignored
- `//lisa-defaults-<category>` → `//end-lisa-defaults-<category>`: Project can override; Lisa provides defaults
- `//lisa-merge-<category>` → `//end-lisa-merge-<category>`: Arrays merged with deduplication

#### Tag Parsing Pattern (`lines 389-411`)

Regex pattern at line 41: `/^\/\/lisa-(force|defaults|merge)-(.+)$/`

Sections extracted by:
1. Finding opening tag key matching pattern
2. Finding closing tag with matching behavior and category
3. Extracting all keys between opening and closing tags
4. Storing as `TagSection` interface from `tagged-merge-types.ts`

#### Merge Logic (`mergeWithTags` method, lines 124-158`)

Three-phase algorithm:
1. Process top-level tagged sections (force/defaults/merge)
2. Process nested objects that contain tags
3. Add unprocessed content from destination (preserves project customizations)

**Key insight:** Unprocessed content outside tagged sections is preserved, allowing projects to add custom scripts/dependencies.

#### Deduplication Pattern (`lines 585-609`)

For merge arrays:
```typescript
private deduplicateArrays(sourceArray: unknown[], destArray: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of sourceArray) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  for (const item of destArray) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}
```

Uses `JSON.stringify()` for value equality. Lisa items first, then project's unique additions.

### 5. Current Package.json Template Files

**Current tagged-merge implementations** (using inline tags):

**TypeScript** (`typescript/tagged-merge/package.json:2-76`)
- Force sections: `scripts-quality-assurance`, `scripts-operations`, `dev-dependencies`
- Defaults sections: `engines` (node, bun, npm, yarn versions)
- Merge sections: `trusted-dependencies` (only `@ast-grep/cli`)

**Expo** (`expo/tagged-merge/package.json:2-146`)
- Force sections: `scripts-*`, `dependencies`, `dev-dependencies`, `resolutions`, `overrides`
- Content includes all Expo/React Native/GraphQL/Gluestack packages

**NestJS** (`nestjs/tagged-merge/package.json:2-88`)
- Force sections: `scripts-*`, `dependencies` (NestJS, Serverless), `dev-dependencies`

**CDK** (`cdk/tagged-merge/package.json:2-38`)
- Force sections: `scripts-operations`, `dependencies` (aws-cdk), `dev-dependencies`, `bin`
- Defaults sections: `engines`

**npm-package** (`npm-package/tagged-merge/`)
- Directory exists but empty (awaiting implementation)

**all/** directory
- No `tagged-merge/` subdirectory currently
- Other copy strategies in `all/copy-overwrite/`, `all/copy-contents/`, `all/create-only/`

### 6. Type Hierarchy and Inheritance

**From** `src/core/config.ts:24-32` and `src/detection/index.ts:56-71`:

```
all/                      (applies to every project)
└── typescript/           (TypeScript projects)
    ├── npm-package/      (publishable npm packages)
    ├── expo/             (Expo projects)
    ├── nestjs/           (NestJS projects)
    └── cdk/              (AWS CDK projects)
```

**Expansion and ordering** (lines 56-71 of detection/index.ts):
1. Detectors identify which types apply (e.g., TypeScript + Expo)
2. Parents added via hierarchy (Expo → includes TypeScript)
3. Ordered by `PROJECT_TYPE_ORDER`: `[typescript, npm-package, expo, nestjs, cdk]`
4. User confirms selected types

**For Expo project:** Inheritance chain is `all → typescript → expo`

**Sequential application** (Lisa.ts:168-179):
```typescript
processProjectType("all")
processProjectType("typescript")
processProjectType("expo")
```

Each subsequent type's `package.lisa.json` merges into destination, potentially overriding previous sections.

### 7. Manifest Recording and File Tracking

**Purpose:** Track which files Lisa applied so uninstall works correctly.

**Manifest file location:** `.lisa-manifest` in project root

**Recording pattern** (all strategies follow):
```typescript
if (!config.dryRun) {
  // ... perform file operation ...
  recordFile(relativePath, this.name);
}
```

**Format example:**
```
# Lisa manifest - DO NOT EDIT
# Generated: 2026-01-28T12:34:56.789Z
# Lisa version: 1.10.0
# Lisa directory: /Users/cody/workspace/lisa

tagged-merge:package.json
copy-overwrite:.prettierrc.json
...
```

**For package-lisa strategy:**
- Must call `context.recordFile("package.json", "package-lisa")`
- Entry: `package-lisa:package.json`
- Enables uninstall via Lisa.ts:377-422 which reads manifest and deletes tracked files

### 8. File Operation Patterns

**Common pattern across all strategies** (`merge.ts:26-82` is typical):

```typescript
async apply(sourcePath, destPath, relativePath, context) {
  const { config, recordFile, backupFile } = context;
  const destExists = await fse.pathExists(destPath);

  // Phase 1: Create if doesn't exist
  if (!destExists) {
    if (!config.dryRun) {
      await ensureParentDir(destPath);
      await copyFile(sourcePath, destPath);
      recordFile(relativePath, this.name);
    }
    return { relativePath, strategy: this.name, action: "copied" };
  }

  // Phase 2: Read and process
  const sourceJson = await readJson(sourcePath);
  const destJson = await readJson(destPath);
  const merged = deepMerge(destJson, sourceJson);

  // Phase 3: Skip if identical
  if (isSame(destJson, merged)) {
    if (!config.dryRun) recordFile(relativePath, this.name);
    return { relativePath, strategy: this.name, action: "skipped" };
  }

  // Phase 4: Merge if different
  if (!config.dryRun) {
    await backupFile(destPath);
    await writeJson(destPath, merged);
    recordFile(relativePath, this.name);
  }

  return { relativePath, strategy: this.name, action: "merged" };
}
```

**For package-lisa strategy:**
- Follow same phases: create → read → process → skip-or-merge → record
- Difference: Load multiple `package.lisa.json` files, merge them per inheritance chain
- Then apply force/defaults/merge logic before writing result

### 9. Error Handling

**Error types** from `src/errors/index.ts`:
- `JsonParseError` - Thrown when JSON parsing fails (line 50-63)
- `JsonMergeError` - Thrown by merge strategies on operation failure (line 65-78)

**Pattern used by merge.ts** (lines 46-51, 53-58):
```typescript
const sourceJson = await readJson<Record<string, unknown>>(sourcePath)
  .catch(() => {
    throw new JsonMergeError(
      relativePath,
      `Failed to parse source: ${sourcePath}`
    );
  });
```

**For package-lisa strategy:**
- Wrap all `readJson` calls with error handling
- Throw `JsonMergeError` if any template file cannot be parsed
- Error will bubble up and be caught by orchestrator

### 10. Testing Patterns

**Test organization** (`tests/unit/strategies/`):
- Separate test file per strategy (e.g., `merge.test.ts`, `tagged-merge.test.ts`)
- Each strategy test follows identical structure
- Uses `createTempDir()` and `cleanupTempDir()` helpers from `tests/helpers/test-utils.ts`

**Test template** (from `copy-overwrite.test.ts:15-30`):
```typescript
describe("CopyOverwriteStrategy", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createContext(overrides = {}): StrategyContext {
    return {
      config: { dryRun: false, yesMode: true, ...overrides },
      recordFile: () => {},
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }
});
```

**Arrangement-Act-Assert pattern**:
1. Set up test files and mocks in temp directory
2. Call `strategy.apply()`
3. Assert result.action and verify file state

**Dry-run tests** (every strategy has one):
```typescript
it("respects dry-run mode", async () => {
  const originalContent = await fs.readFile(destFile, "utf-8");

  await strategy.apply(srcFile, destFile, relativePath,
    createContext({ dryRun: true }));

  const finalContent = await fs.readFile(destFile, "utf-8");
  expect(finalContent).toBe(originalContent); // File unchanged
});
```

**Tagged-merge test suite** (`tagged-merge.test.ts:10-781`):
- 30 tests organized into 6 nested describe blocks
- Tests: core behavior, force behavior, defaults behavior, merge behavior, complex scenarios, edge cases
- Reuses context mocks for capturing callback invocations

### 11. Existing Merge vs Package-Lisa Differences

**Current tagged-merge approach:**
- Tag values embedded in `package.json` file itself
- Bun treats `//lisa-force-dev-dependencies` as package name (install failure)
- Knip can't ignore `/` prefixed entries (false positives in dependency analysis)

**Package-lisa approach:**
- Tags and behavior definitions moved to separate `package.lisa.json` files
- Project's `package.json` remains 100% clean
- Resolves both Bun and Knip compatibility issues

**Implementation difference:**
- Tagged-merge: Parses tags from source JSON, routes to behavior handlers
- Package-lisa: Loads multiple template files, merges them, then applies behaviors

**Data structure difference:**
- Tagged-merge: `//lisa-<behavior>-<category>` are keys in JSON
- Package-lisa: Behaviors defined as top-level keys: `{ force: {}, defaults: {}, merge: {} }`

## Reusable Code and Patterns

### 1. File Operations
- `ensureParentDir()` - Create parent directories before writing (used by all strategies)
- `filesIdentical()` - Compare file contents (used by copy-overwrite)
- Both in `src/utils/file-operations.ts`

### 2. JSON Operations
- `readJson<T>()` - Read and parse JSON with type safety
- `writeJson()` - Serialize and write JSON with formatting
- `deepMerge<T>()` - Immutable deep merge (Lisa values override)
- All in `src/utils/json-utils.ts` (ready to reuse)

### 3. Strategy Patterns
- `CopyOverwriteStrategy` - Template for file comparison and prompt handling
- `MergeStrategy` - Template for JSON merge operations (most similar to package-lisa needs)
- `TaggedMergeStrategy` - Template for complex JSON behavior routing

### 4. Error Types
- `JsonParseError` - For JSON parsing failures
- `JsonMergeError` - For merge operation failures
- Both from `src/errors/index.ts`

### 5. Test Utilities
- `createTempDir()` / `cleanupTempDir()` - Temporary file system setup (from `tests/helpers/test-utils.ts`)
- Context mock factory pattern - Reusable across all strategy tests
- Dry-run assertion patterns - Every test includes these

## Code References

### Core Strategy Files
- `src/strategies/strategy.interface.ts:31-49` - ICopyStrategy interface
- `src/strategies/index.ts:19-75` - StrategyRegistry implementation
- `src/strategies/merge.ts:26-82` - MergeStrategy implementation (model for package-lisa)
- `src/strategies/tagged-merge.ts:549-573` - applyMergeSection behavior (reference for array deduplication)

### Configuration and Types
- `src/core/config.ts:4-9` - CopyStrategy union type (needs `package-lisa` added)
- `src/core/config.ts:84-95` - FileOperationResult interface

### Utilities
- `src/utils/json-utils.ts:73-76` - deepMerge function (ready to reuse)
- `src/utils/json-utils.ts:10-20` - readJson function (ready to reuse)
- `src/utils/json-utils.ts:43-50` - writeJson function (ready to reuse)

### Error Handling
- `src/errors/index.ts:50-63` - JsonParseError
- `src/errors/index.ts:65-78` - JsonMergeError

### Tests
- `tests/unit/strategies/merge.test.ts` - Merge strategy test template (similar to what package-lisa will need)
- `tests/unit/strategies/tagged-merge.test.ts:10-40` - Test structure with setup/mocks (reusable pattern)
- `tests/helpers/test-utils.ts` - Temporary directory and file utilities

### Current Templates
- `typescript/tagged-merge/package.json` - Base TypeScript template (will be converted to package.lisa.json)
- `expo/tagged-merge/package.json` - Expo-specific template
- `nestjs/tagged-merge/package.json` - NestJS-specific template
- `cdk/tagged-merge/package.json` - CDK-specific template

## Architecture Documentation

### Strategy Selection and Execution Flow

```
Lisa.apply()
├── 1. Detect project types
│   └── StrategyRegistry.expandAndOrderTypes() → [typescript, expo, ...]
│
├── 2. Process configurations
│   ├── processProjectType("all")
│   ├── processProjectType("typescript")
│   └── processProjectType("expo")
│       └── For each type, check all strategies: copy-overwrite, copy-contents, create-only, merge, tagged-merge, package-lisa
│
├── 3. Apply strategy
│   └── strategy.apply(sourcePath, destPath, relativePath, context)
│       ├── Read source file(s)
│       ├── Read destination file (if exists)
│       ├── Merge/process
│       ├── Write result
│       └── Record in manifest
│
└── 4. Record and report results
    └── Return operation counts (copied, skipped, merged, etc.)
```

### Merge Operation Sequence (for package-lisa strategy)

```
apply(sourcePath="/lisa/typescript/tagged-merge/package.lisa.json",
      destPath="/project/package.json")
│
├── Phase 1: Load all templates from inheritance chain
│   ├── Load /lisa/all/tagged-merge/package.lisa.json (if exists)
│   ├── Load /lisa/typescript/tagged-merge/package.lisa.json
│   └── Load /lisa/expo/tagged-merge/package.lisa.json (if exists)
│
├── Phase 2: Merge templates by inheritance
│   ├── Merge all → typescript (typescript overrides all)
│   └── Merge result → expo (expo overrides typescript)
│   └── Result: combined {force, defaults, merge} structure
│
├── Phase 3: Apply to project package.json
│   ├── Read destination /project/package.json
│   ├── Apply force sections: deep merge with Lisa values winning
│   ├── Apply defaults sections: deep merge with project values winning (only if missing)
│   ├── Apply merge sections: concatenate arrays with deduplication
│   └── Write result back
│
└── Phase 4: Record and return
    └── Call context.recordFile("package.json", "package-lisa")
    └── Return {relativePath: "package.json", strategy: "package-lisa", action: "merged"}
```

## Testing Patterns Established

### 1. Test Setup Pattern
- Create temp directories for source and destination
- Instantiate strategy class
- Create context mock with config and callbacks

### 2. Assertion Pattern
- Check result.action matches expected (copied, skipped, merged)
- Verify file state changed (or not) as expected
- Verify callbacks were called (for backup, record)

### 3. Dry-Run Testing
- All strategies tested with dryRun: true
- Verify files unchanged but action still reported
- Pattern repeated across all 5 existing strategies

### 4. Error Testing
- Invalid JSON causes throw
- Missing files handled appropriately
- Parent directory creation verified

## Open Questions

### Q1: Template File Discovery and Merging
**Question:** Should `package-lisa` strategy always load files from inheritance chain (all → typescript → specific), or should orchestrator pass merged template?

**Context:** Currently orchestrator calls strategy once per file in a type directory. Package.lisa.json files exist across multiple types (all/, typescript/, expo/). The strategy needs to collect and merge them.

**Impact:** Affects design - either strategy loads all templates or orchestrator pre-merges them.

**Recommendation:** Strategy should load templates from inheritance chain (similar to how detect/type detection works). This:
- Keeps strategy responsible for its complete operation
- Matches pattern used by existing detect/type expansion logic
- Makes testing easier (can test merge logic in isolation)
- Doesn't require orchestrator changes

**Answer:** _[Human approval needed]_

### Q2: Nested Object Merging in Force/Defaults
**Question:** When applying force section on nested objects (e.g., engines has node, npm, bun), should force replace entire object or merge keys?

**Context:** Force semantics: "Lisa's values win completely". But some objects like `engines` have multiple keys. Does "force" mean:
- A) Replace entire engines object (Lisa's engines fully replace project's)
- B) Deep merge engines object (Lisa's engine keys override project's, but preserve others)

**Impact:** Affects how templates define what "force" means for nested structures.

**Recommendation:** Option A (replace entire object) is simpler and more predictable. If a section is forced, it means the entire structure is Lisa's. Projects using forced sections can't override any nested values. This is appropriate for "governance-critical" configs.

**Answer:** _[Human approval needed]_

### Q3: Deduplication Strategy for Arrays
**Question:** Should array deduplication in merge sections use `JSON.stringify()` like tagged-merge does, or more intelligent comparison?

**Context:** For trustedDependencies or similar arrays, deduplication needs value equality. Tagged-merge uses `JSON.stringify()` which means:
- Same string values deduplicate
- Objects with same keys/values deduplicate
- But object key order matters for equality

**Impact:** Affects what gets merged when projects add custom array items.

**Recommendation:** Use same `JSON.stringify()` approach as tagged-merge for consistency. It's simple and works well for typical package.json use cases (strings, simple objects).

**Answer:** _[Human approval needed]_

### Q4: Migration Path from tagged-merge to package-lisa
**Question:** Should both strategies coexist during transition, or require complete replacement?

**Context:** Spec mentions keeping old files as backup, but orchestrator needs to choose which strategy to use.

**Impact:** Can't apply both strategies to same file; must pick one per installation.

**Recommendation:** Implement package-lisa as new strategy, but don't remove tagged-merge. Lisa application will use package-lisa if `package.lisa.json` exists, otherwise fall back to tagged-merge. This allows gradual migration.

**Answer:** _[Human approval needed]_

## Summary of Findings

✅ **Ready to implement:** All core infrastructure exists (strategy interface, registry, utilities, test patterns)

✅ **Reusable code:** deepMerge, readJson, writeJson, error types, test helpers all available

✅ **Reference implementations:** MergeStrategy and TaggedMergeStrategy provide excellent implementation templates

✅ **Test coverage:** Existing test patterns (dry-run, temp files, context mocks) directly applicable

⚠️ **Open questions:** Template loading approach, force/defaults semantics for nested objects, array deduplication, migration path

**No major gaps identified.** Implementation can proceed once open questions are resolved.
