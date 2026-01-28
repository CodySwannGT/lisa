---
date: 2026-01-28T00:00:00Z
status: complete
last_updated: 2026-01-28
---

# Research: Tagged-Merge Strategy Implementation

## Summary

The Lisa codebase has a well-established strategy pattern for applying copy strategies (copy-overwrite, copy-contents, create-only, merge) across multiple project types with proper inheritance and cascading. The merge strategy currently performs deep JSON merging with Lisa values taking precedence. To implement tagged-merge, we need to:

1. Create a new `TaggedMergeStrategy` class that parses JSON comment-based tags
2. Implement three merge behaviors: force (replace), defaults (project override), merge (array combine)
3. Register it in the strategy registry and add it to the copy strategies list
4. Update the configuration detection logic to prefer tagged-merge/ over merge/ when both exist
5. Create comprehensive test coverage following existing test patterns
6. Migrate existing merge/ files to tagged-merge/ directories with proper tag annotations

The implementation leverages existing utilities for JSON handling, file operations, and follows all established patterns in the codebase.

## Detailed Findings

### Strategy Architecture

#### Strategy Interface and Registration

**Location**: `src/strategies/strategy.interface.ts:31-49`, `src/strategies/index.ts:17-64`

All strategies implement `ICopyStrategy`:
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

The `StrategyRegistry` (lines 17-64 of index.ts) manages all strategy instances:
- Strategies are instantiated in constructor with defaults (lines 22-27)
- `get(name)` retrieves by name with error checking (line 30)
- `getAll()` returns all registered strategies (line 37)

**Current strategies** (line 50 of config.ts):
```typescript
export const COPY_STRATEGIES: readonly CopyStrategy[] = [
  "copy-overwrite",
  "copy-contents",
  "create-only",
  "merge",
];
```

These are applied in strict order (lines 504-514 of lisa.ts) for each project type.

#### Context Object

**Location**: `src/strategies/strategy.interface.ts:54-75`

Every strategy receives `StrategyContext`:
```typescript
export interface StrategyContext {
  readonly config: LisaConfig;
  readonly recordFile: (relativePath: string, strategy: CopyStrategy) => void;
  readonly backupFile: (absolutePath: string) => Promise<void>;
  readonly promptOverwrite: (...args) => Promise<boolean>;
}
```

- **config**: Contains `dryRun`, `yesMode`, `validateOnly`, `destDir`, `lisaDir`
- **recordFile**: Called to track file in manifest (`.lisa-manifest`)
- **backupFile**: Creates timestamped backups before modifying files (lines 74-80 in merge.ts)
- **promptOverwrite**: Used by copy-overwrite to prompt user on conflicts

### Existing Merge Strategy Implementation

**Location**: `src/strategies/merge.ts`

The merge strategy provides the foundation for tagged-merge:

**Flow** (lines 26-81):
1. Check if destination exists
   - If not: copy source file silently
   - If exists: proceed to merge logic
2. Parse both JSON files with error handling via `readJson()` (lines 45-58)
3. Deep merge using `deepMerge()` function (line 61)
   - Uses `lodash.merge` under the hood (utils/json-utils.ts:76)
   - Source (Lisa) values take precedence over destination (project) values
   - Nested objects are merged recursively
   - **Arrays are replaced entirely, not merged** (important for tagged-merge design)
4. Normalize both JSONs via `JSON.stringify(_, null, 2)` (lines 64-65)
5. Compare normalized versions to detect if merge changed anything (line 67)
6. If changed:
   - Backup destination file (line 76)
   - Write merged result via `writeJson()` (line 77)
   - Record in manifest (line 78)
7. Return result with action type: "copied", "skipped", or "merged" (lines 43, 70, 80)

**Key utilities**:
- `readJson<T>()` (utils/json-utils.ts:10-20): Reads and parses JSON with error handling
- `writeJson()` (utils/json-utils.ts:43-50): Writes with 2-space indentation + trailing newline
- `deepMerge()` (utils/json-utils.ts:73-76): Uses `merge()` from lodash.merge package
- `ensureParentDir()` (utils/file-operations.ts:29-31): Creates parent directory if needed

### JSON Handling Utilities

**Location**: `src/utils/json-utils.ts`

**Available functions**:
- `readJson<T>(filePath)` - Parses JSON with custom error handling, throws JsonParseError
- `readJsonOrNull<T>(filePath)` - Returns null on parse errors instead of throwing
- `writeJson(filePath, data, spaces=2)` - Writes JSON with optional indentation
- `isValidJson(filePath)` - Returns boolean without throwing
- `deepMerge<T extends object>(base, override)` - Deep merges objects via lodash.merge

**Error handling**:
- `JsonParseError` (errors/index.ts:68-78): Thrown when JSON parsing fails
- `JsonMergeError` (errors/index.ts:81-93): Thrown when merge operation fails

### File Operations and Discovery

**Location**: `src/utils/file-operations.ts`

**Key functions**:
- `listFilesRecursive(dir)` (lines 88-118): Recursively walks directory tree returning all file paths
  - Uses `readdir()` with `withFileTypes: true` for performance
  - Maps entries in parallel, recurses into subdirectories
  - Returns flattened array of all file paths
- `filesIdentical(path1, path2)` (lines 135-142): Compares file content via crypto hash
- `ensureParentDir(dir)` (lines 29-31): Uses `fs-extra.ensureDir()` to create parent directories
- `copyFile(src, dest)` (line 38): Uses `node:fs/promises.copyFile()`
- `readFile()`, `writeFile()`: Node.js fs/promises wrappers

### Project Type Detection and Cascade

**Location**: `src/detection/index.ts`, `src/core/config.ts`

**Type Hierarchy** (config.ts:23-31):
```typescript
export const PROJECT_TYPE_HIERARCHY = {
  expo: "typescript",
  nestjs: "typescript",
  cdk: "typescript",
  "npm-package": "typescript",
  typescript: undefined,
};
```

**Processing Order** (config.ts:36-42):
```typescript
export const PROJECT_TYPE_ORDER = [
  "typescript",
  "npm-package",
  "expo",
  "nestjs",
  "cdk",
];
```

**Application Cascade** (lisa.ts:157-180):
1. Always process `all/` first (line 169)
2. For each detected type in canonical order (line 171):
   - Load type directory if exists
   - Apply all strategies in sequence (copy-overwrite → copy-contents → create-only → merge)
3. Each strategy processes files recursively in its subdirectory

**Type Expansion** (detection/index.ts:56-71):
- Detectors return raw types
- `expandAndOrderTypes()` adds parent types via hierarchy lookup
- Results ordered via PROJECT_TYPE_ORDER for consistency

### Strategy Application Orchestration

**Location**: `src/core/lisa.ts`

**Main flow** (lines 329-340):
```typescript
async apply() {
  await this.detectTypes();           // Expand types to include parents
  await this.processConfigurations(); // Apply strategies
  ...
}
```

**Configuration processing** (lines 157-180):
1. Load `.lisaignore` patterns from destination
2. Process `all/` directory
3. For each detected type, call `processProjectType(type)`

**Per-type processing** (lines 502-513):
```typescript
for (const strategy of COPY_STRATEGIES) {
  const srcDir = path.join(this.config.lisaDir, type, strategy);
  if (await fse.pathExists(srcDir)) {
    await this.processDirectory(srcDir, strategyRegistry.get(strategy));
  }
}
```

**Directory processing** (lines 522-579):
1. List all files recursively (line 535)
2. Filter by `.lisaignore` patterns (lines 538-550)
3. For each file:
   - Compute destination path relative to project root (line 568)
   - Call `strategy.apply(src, dest, relativePath, context)` (lines 573-577)
   - Track result for logging and manifest (lines 578-579)

### Ignore Pattern Handling

**Location**: `src/utils/ignore-patterns.ts`

**Format**: `.lisaignore` uses gitignore-style syntax

**Pattern matching** (lines 44-87):
- Directory patterns ending with `/` (lines 53-58)
- Exact filename matches (lines 62-63)
- Glob patterns via `minimatch` library (line 67)
- Patterns without slashes match any path segment (lines 72-77)
- `**/` wildcards for matching at any depth (lines 81-82)

### Template Directory Structure

**Location**: `all/`, `typescript/`, `expo/`, `nestjs/`, `cdk/`, `npm-package/`

**Example structure** (typescript/):
```text
typescript/
├── copy-overwrite/        # Files to overwrite (ESLint, Prettier, tsconfig, etc.)
│   ├── eslint.config.mjs
│   ├── .prettierrc.json
│   └── tsconfig.json
├── copy-contents/         # Append content to files (e.g., .husky hooks)
│   └── .husky/
│       └── pre-commit
├── create-only/          # Create once, never update (e.g., PROJECT_RULES.md)
│   └── .claude/
│       └── rules/
│           └── PROJECT_RULES.md
└── merge/                # Deep merge JSON files (package.json)
    └── package.json
```

**New tagged-merge structure** (to be created):
```text
typescript/
└── tagged-merge/         # JSON with comment-based tags
    └── package.json      # With //lisa-force-*, //lisa-defaults-*, //lisa-merge-* tags
```

## Code References

### Key Files

| File | Purpose |
|------|---------|
| `src/strategies/strategy.interface.ts` | ICopyStrategy interface and StrategyContext |
| `src/strategies/index.ts` | StrategyRegistry class and exports |
| `src/strategies/merge.ts` | Current merge strategy implementation |
| `src/strategies/copy-overwrite.ts` | Copy-overwrite strategy (simple file copy) |
| `src/strategies/copy-contents.ts` | Copy-contents strategy (marker-based append) |
| `src/strategies/create-only.ts` | Create-only strategy (one-time creation) |
| `src/core/config.ts` | Type definitions, strategy list, type hierarchy |
| `src/core/lisa.ts` | Main orchestration logic for strategy application |
| `src/utils/json-utils.ts` | JSON parsing, writing, merging utilities |
| `src/utils/file-operations.ts` | File discovery, reading, writing, comparison |
| `src/utils/ignore-patterns.ts` | .lisaignore parsing and matching |
| `src/errors/index.ts` | Custom error classes |
| `tests/unit/strategies/` | Existing strategy test files |
| `tests/helpers/test-utils.ts` | Shared testing utilities and fixtures |

## Reusable Code

### Existing Functions for Tagged-Merge

**JSON Operations**:
- `readJson<T>(filePath)` - Parse source and destination JSON files
- `writeJson(filePath, data, spaces=2)` - Write merged JSON with 2-space indentation
- `deepMerge<T>(base, override)` - Use for merging non-tagged sections
- `isValidJson(filePath)` - Validate JSON before parsing

**Error Handling**:
- `JsonParseError` and `JsonMergeError` classes for custom error reporting
- Pattern: catch parse errors and re-wrap with file path context

**File Operations**:
- `ensureParentDir(destPath)` - Create parent directory for new files
- `listFilesRecursive(dir)` - Not needed for tagged-merge (already called by orchestrator)
- `filesIdentical(path1, path2)` - Could be used to skip unchanged files

**Utilities**:
- `readFile()`, `writeFile()` - Basic file I/O
- `fse.pathExists()` - From fs-extra for existence checks

### Existing Patterns to Follow

**Strategy Implementation Pattern** (merge.ts):
- Implement `ICopyStrategy` interface with `apply()` method
- Use `StrategyContext` for callbacks (recordFile, backupFile, etc.)
- Return `FileOperationResult` with action, relativePath, strategy name
- Respect `config.dryRun` flag
- Backup before modifying existing files
- Always record files in manifest

**Error Handling Pattern** (merge.ts:45-58):
- Try-catch with custom error classes
- Include file path in error message
- Return result object for proper logging

**JSON Normalization Pattern** (merge.ts:64-71):
- Stringify both versions with `JSON.stringify(obj, null, 2)`
- Compare for equality to detect changes
- Only write if changes detected

**Testing Pattern** (merge.test.ts):
- Use Vitest framework with describe/it blocks
- Create temporary directories in beforeEach, clean in afterEach
- Use createContext() helper to build mock StrategyContext
- Mock callbacks to verify they're called correctly
- Test with both real files and in-memory JSON objects
- Test dry-run mode separately
- Test error conditions

## Architecture Documentation

### Tagged-Merge Strategy Design

**Key Difference from Merge Strategy**:
- Current merge: All of Lisa's values win on conflict
- Tagged-merge: Section-by-section control via comment tags

**Three Behaviors**:

1. **Force** (`//lisa-force-<name>` ... `//end-lisa-force-<name>`):
   - Lisa replaces entire section, project changes ignored
   - Use for CI/CD scripts, required dependencies

2. **Defaults** (`//lisa-defaults-<name>` ... `//end-lisa-defaults-<name>`):
   - Lisa provides values, project can override entire section
   - Use for optional settings like Node version

3. **Merge** (`//lisa-merge-<name>` ... `//end-lisa-merge-<name>`):
   - For arrays: combine Lisa's + project's items (deduplicated)
   - Use for expanding arrays like trustedDependencies

**Implementation Requirements**:
1. Parse JSON file character-by-character to preserve key ordering
2. Identify comment keys as tags (keys starting with "//")
3. Extract content between opening and closing tags
4. Apply merge logic per behavior type
5. Preserve untagged content and order

### Strategy Processing Order

Current order remains (no changes needed):
1. copy-overwrite
2. copy-contents
3. create-only
4. merge
5. **tagged-merge** (NEW - add after merge)

### Configuration Detection

**Current behavior** (lisa.ts:502-513):
- Looks for `type/merge/` directories
- Applies merge strategy to files found there

**New behavior needed**:
- Check for `type/tagged-merge/` first
- If not found, check `type/merge/` (backward compatibility)
- Add `tagged-merge` to COPY_STRATEGIES list

**Location to modify**:
- `src/core/config.ts` - Add "tagged-merge" to CopyStrategy type union and COPY_STRATEGIES array
- `src/strategies/index.ts` - Import and instantiate TaggedMergeStrategy in registry constructor
- `src/core/lisa.ts` - No changes needed (uses COPY_STRATEGIES constant)

## Testing Patterns

### Unit Test Framework

**Framework**: Vitest 3.0
**Location**: `tests/unit/strategies/`
**Test files**: `{strategy-name}.test.ts`
**Coverage**: 90% threshold across statements, branches, functions, lines

**Structure** (example from merge.test.ts):
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MergeStrategy } from "../../../src/strategies/merge.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("MergeStrategy", () => {
  let strategy: MergeStrategy;
  let tempDir: string;

  beforeEach(async () => {
    strategy = new MergeStrategy();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("descriptive test name", async () => {
    // Setup
    // Act
    // Assert
  });
});
```

### Test Coverage Requirements

**For TaggedMergeStrategy** (from brief.md):
1. Force behavior - replaces entire section, project changes ignored
2. Defaults behavior - preserves project overrides or adds if missing
3. Array merge behavior - combines with deduplication
4. Multiple tags in one object - order preservation
5. Edge cases - missing tags, empty sections, nested objects
6. Inheritance resolution - conflicting tags across type hierarchy

### Context Mock Pattern

**From merge.test.ts**:
```typescript
function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
  const config: LisaConfig = {
    lisaDir: srcDir,
    destDir,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    ...overrides,
  };

  return {
    config,
    recordFile: () => {},
    backupFile: async () => {},
    promptOverwrite: async () => true,
  };
}
```

### Test Utilities

**Location**: `tests/helpers/test-utils.ts`
**Available**:
- `createTempDir()` - Creates isolated temp directory with prefix
- `cleanupTempDir(dir)` - Recursively removes temp directory
- `createMinimalProject(dir)` - Creates basic package.json
- `createTypeScriptProject(dir)` - Adds tsconfig.json
- `createExpoProject(dir)`, `createNestJSProject(dir)`, `createCDKProject(dir)` - Type-specific setups
- `createMockLisaDir(dir)` - Creates full Lisa structure with all strategies

## Documentation Patterns

### JSDoc Conventions

**From existing strategies** (merge.ts):
- File-level preamble with purpose and overview
- Function-level JSDoc with @param, @returns
- Inline comments for complex logic
- Error cases documented in JSDoc

**Required sections**:
- What the strategy does
- Which behaviors it implements
- Edge cases and limitations

### Type Definitions

**Use existing patterns**:
- `StrategyContext` interface for parameters
- `FileOperationResult` interface for return type
- `CopyStrategy` type union for strategy names
- `LisaConfig` interface for configuration

## Impacted Tests

### Tests Requiring Modification

**`tests/unit/strategies/merge.test.ts`**:
- May need to ensure merge strategy doesn't interfere with tagged-merge
- Should already have comprehensive coverage

**`tests/unit/` (general)**:
- If config detection logic changes, may need to update how strategies are selected in tests

### New Test File Needed

**`tests/unit/strategies/tagged-merge.spec.ts`** (NEW):
- Comprehensive test suite for all three behaviors
- At least 20+ test cases for 90% coverage
- Edge case coverage per brief.md requirements

### Test Gaps Identified

- No existing tests for comment-based tag parsing (tagged-merge will be first)
- No existing tests for array merging/deduplication in strategies
- No existing tests for inheritance/cascade conflicts (but should be covered at integration level)

## Open Questions

### Q1: JSON Key Ordering Preservation

**Question**: Modern JSON libraries like `JSON.parse()` preserve key order, but should tagged-merge guarantee strict key ordering as it appears in Lisa's template?

**Context**: The brief mentions "Preserve order (Lisa's content, then project's content)" but it's unclear if this means:
- Order from Lisa template first, then project additions
- Exact ordering maintained within tagged sections
- Can untagged content be interspersed between tagged sections?

**Impact**: Affects the complexity of the parsing/reconstruction algorithm. If strict ordering from template is required, we need a different approach than simple JSON manipulation.

**Recommendation**: Implement strict ordering—always use Lisa template order for tagged sections, append project's untagged content at the end. This provides predictable, auditable results.

**Answer**: The order has to match what is in the templates and start and end tags need to be preserved. this is a hard requirement

---

### Q2: Array Deduplication Strategy

**Question**: For merge behavior with arrays, how should deduplication work?

**Context**:
- By JSON value equality (current lodash.merge behavior)?
- By object reference (requires tracking which items came from Lisa)?
- By shallow comparison vs deep comparison?

**Example**:
```json
// Lisa
"trustedDependencies": ["@ast-grep/cli", { "name": "esbuild", "version": "^0.20.0" }]

// Project
"trustedDependencies": ["@ast-grep/cli", { "name": "esbuild" }]

// Should these be deduplicated as same, or different?
```

**Impact**: Affects how we compare array items and whether we need custom equality logic.

**Recommendation**: Use JSON.stringify() for value equality—if two items stringify identically, they're duplicates. This matches the brief's mention of "JSON value equality."

**Answer**: use the recommendation

---

### Q3: Nested Tag Support

**Question**: Should tagged-merge support tags inside nested objects, as mentioned in "Future Enhancements"?

**Context**: The brief mentions nested tag support is for future, but implementation complexity changes if we need to handle:
```json
{
  "jest": {
    "//lisa-force-preset": "...",
    "preset": "ts-jest",
    "//end-lisa-force-preset": ""
  }
}
```

**Impact**: If required now, significantly increases parsing complexity. If postponed, we only need to handle tags at top level.

**Recommendation**: Support tags only at top level of JSON object in Phase 1. Reserve nested tags for Phase 2.

**Answer**: Look at the existing tagged-merge/package.json - we need to support what they do today immediately.

---

### Q4: Migration Approach

**Question**: Should we migrate existing `merge/package.json` files to `tagged-merge/package.json`, or create both directories simultaneously?

**Context**: The brief mentions keeping both strategies available for backward compatibility, but:
- Do we move existing files or copy them?
- Do we create tagged-merge as entirely new files?
- What about other JSON files beyond package.json?

**Impact**: Affects file structure, git history, and compatibility timeline.

**Recommendation**: Create new `tagged-merge/` directories with migrated files. Keep `merge/` for backward compatibility but deprecate with documentation. Only migrate files we actively use.

**Answer**: I've already taken care of this.

---

## Summary of Implementation Path

1. **Phase 1: Core Strategy** (2-3 sessions)
   - Create `src/strategies/tagged-merge.ts` with tag parsing and three merge behaviors
   - Implement JSON reconstruction preserving order
   - Handle all three behaviors: force, defaults, merge

2. **Phase 2: Integration** (1 session)
   - Register in `src/strategies/index.ts`
   - Add to `COPY_STRATEGIES` in `src/core/config.ts`
   - Update detection to check for tagged-merge/ first

3. **Phase 3: Configuration & File Structure** (1 session)
   - Create `tagged-merge/` directories for each project type
   - Migrate existing `merge/package.json` files with proper tags

4. **Phase 4: Testing** (2 sessions)
   - Write comprehensive test suite in `tests/unit/strategies/tagged-merge.spec.ts`
   - Ensure 90%+ coverage of all behaviors and edge cases
   - Test inheritance resolution

5. **Phase 5: Verification** (1 session)
   - Regression test all existing strategies
   - End-to-end test of complete Lisa apply process
   - Verify backward compatibility with existing merge/ directories

## Technical Debt Considerations

- The strategy pattern is well-designed and doesn't need changes
- JSON handling utilities are solid and reusable
- Test infrastructure is comprehensive
- No security concerns identified (JSON parsing is safe, no user code execution)
- Performance should be fine (single file reads/writes, no bulk operations)

