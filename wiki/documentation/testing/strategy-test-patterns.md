# Strategy Test Patterns

This document catalogs the test patterns used in Lisa's copy strategy tests, providing examples for implementing tests for the package-lisa strategy.

## Test File Locations

All strategy tests are located in `/Users/cody/workspace/lisa/tests/unit/strategies/`:

- `tagged-merge.test.ts` - 782 lines, 30 test cases covering tagged-merge strategy
- `merge.test.ts` - 228 lines, 10 test cases covering JSON deep merge strategy
- `copy-overwrite.test.ts` - 216 lines, 10 test cases covering file overwrite strategy
- `copy-contents.test.ts` - 269 lines, 9 test cases covering append-with-markers strategy
- `create-only.test.ts` - 169 lines, 7 test cases covering create-if-missing strategy

## Test Framework

All strategy tests use **Jest** with the following configuration:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
```

**Key testing library**: `fs-extra` for filesystem operations and `path` for path management.

## General Test Structure

### Setup Pattern

All strategy tests follow the same setup pattern:

```typescript
describe("StrategyName", () => {
  let strategy: StrategyName;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new StrategyName();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // Tests follow...
});
```

**Found in**:
- `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:10-27`
- `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:15-32`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:13-30`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-contents.test.ts:13-30`
- `/Users/cody/workspace/lisa/tests/unit/strategies/create-only.test.ts:9-26`

### Context Creation Helper

Every test file includes a helper function to create strategy context:

```typescript
/**
 * Create a strategy context for testing
 * @param overrides - Configuration overrides
 * @returns Strategy context with test defaults
 */
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

**Found in**:
- `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:34-50`
- `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:39-55`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:37-53`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-contents.test.ts:37-53`
- `/Users/cody/workspace/lisa/tests/unit/strategies/create-only.test.ts:33-49`

**Key aspects**:
- Uses `fs-extra` for file operations
- Mocks `recordFile`, `backupFile`, and `promptOverwrite` with no-op defaults
- Allows overriding config via parameter for testing different modes (dryRun, yesMode, etc.)

## Temporary File Management

### Helper Utilities

Located in `/Users/cody/workspace/lisa/tests/helpers/test-utils.ts`:

```typescript
/**
 * Create a temporary directory for testing
 * @returns Promise resolving to path of created temporary directory
 */
export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), LISA_TEST_PREFIX));
}

/**
 * Clean up a temporary directory
 * @param dir - Directory path to remove
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  if (dir && (await fs.pathExists(dir))) {
    await fs.remove(dir);
  }
}
```

**Key aspects**:
- Uses `os.tmpdir()` with prefix `lisa-test-` for easy identification
- Cleanup checks if directory exists before removing (safe cleanup)
- Both are async functions called in beforeEach/afterEach

### File Creation Patterns

Files are created using `fs-extra` methods:

```typescript
// Text files
await fs.writeFile(srcFile, "content string");

// JSON files
await fs.writeJson(srcFile, { key: "value" });

// Directory creation
await fs.ensureDir(srcDir);

// Ensure both parent and file
await fs.ensureDir(path.dirname(srcFile));
await fs.writeFile(srcFile, content);
```

**Cleanup strategy**:
- Single temp directory per test created in beforeEach
- Entire tree removed in afterEach via `fs.remove()`
- No per-test file deletion needed (directory handles all)

## Arrange-Act-Assert Pattern

All tests follow the standard AAA pattern:

### Example from Copy-Overwrite

```typescript
it("overwrites when files differ and promptOverwrite returns true", async () => {
  // ARRANGE: Set up test files and context
  const srcFile = path.join(srcDir, TEST_FILE);
  const destFile = path.join(destDir, TEST_FILE);
  await fs.writeFile(srcFile, NEW_CONTENT);
  await fs.writeFile(destFile, OLD_CONTENT);

  let backupCalled = false;
  const context = {
    ...createContext(),
    backupFile: async () => {
      backupCalled = true;
    },
    promptOverwrite: async () => true,
  };

  // ACT: Execute the strategy
  const result = await strategy.apply(srcFile, destFile, TEST_FILE, context);

  // ASSERT: Verify behavior
  expect(result.action).toBe("overwritten");
  expect(backupCalled).toBe(true);
  expect(await fs.readFile(destFile, "utf-8")).toBe(NEW_CONTENT);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:92-112`

### AAA Applied to JSON Merge

```typescript
it("deep merges objects with Lisa values taking precedence", async () => {
  // ARRANGE
  const srcFile = path.join(srcDir, PACKAGE_JSON);
  const destFile = path.join(destDir, PACKAGE_JSON);

  await fs.writeJson(srcFile, {
    scripts: { test: "vitest", build: "tsc" },
    devDependencies: { vitest: "^1.0.0" },
  });

  await fs.writeJson(destFile, {
    name: "my-project",
    scripts: { build: "rollup" },
  });

  // ACT
  const result = await strategy.apply(
    srcFile,
    destFile,
    PACKAGE_JSON,
    createContext()
  );

  // ASSERT
  expect(result.action).toBe("merged");

  const content = await fs.readJson(destFile);
  expect(content).toEqual({
    name: "my-project",
    scripts: {
      test: "vitest",
      build: "tsc",
    },
    devDependencies: { vitest: "^1.0.0" },
  });
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:79-113`

## Test Data Patterns

### Constants for Reuse

Test files define constants at the top for file names and content:

```typescript
// From copy-overwrite.test.ts
const TEST_FILE = "TEST_FILE";
const NEW_CONTENT = "new content";
const OLD_CONTENT = "old content";

// From copy-contents.test.ts
const GITIGNORE = ".gitignore";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";

// From merge.test.ts
const PACKAGE_JSON = "package.json";
const SETTINGS_JSON = "settings.json";
const CONFIG_JSON = "config.json";
```

**Benefit**: Reduces duplication and makes test intent clear.

### Inline Data Setup

Most tests create data inline within each test for clarity:

```typescript
it("handles nested objects", async () => {
  const srcFile = path.join(srcDir, SETTINGS_JSON);
  const destFile = path.join(destDir, SETTINGS_JSON);

  // Setup source
  await fs.writeJson(srcFile, {
    editor: {
      tabSize: 2,
      formatOnSave: true,
    },
  });

  // Setup destination
  await fs.writeJson(destFile, {
    editor: {
      tabSize: 4,
    },
  });

  // Act and assert...
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:151-173`

## Mock Pattern for Context

### Capturing Mock Calls

When testing side effects (backup, record), mocks capture state:

```typescript
it("backs up file before merging", async () => {
  const srcFile = path.join(srcDir, PACKAGE_JSON);
  const destFile = path.join(destDir, PACKAGE_JSON);
  await fs.writeJson(srcFile, { new: "value" });
  await fs.writeJson(destFile, { existing: "value" });

  let backupCalled = false;
  const context = {
    ...createContext(),
    backupFile: async () => {
      backupCalled = true;
    },
  };

  await strategy.apply(srcFile, destFile, PACKAGE_JSON, context);

  expect(backupCalled).toBe(true);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:132-149`

### Capturing Call Arguments

More detailed testing captures the actual arguments passed:

```typescript
it("records file in manifest when copying", async () => {
  const srcFile = path.join(srcDir, TEST_FILE);
  const destFile = path.join(destDir, TEST_FILE);
  await fs.writeFile(srcFile, "content");

  let recorded: { path: string; strategy: string } | null = null;
  const context = {
    ...createContext(),
    recordFile: (relativePath: string, strat: string) => {
      recorded = { path: relativePath, strategy: strat };
    },
  };

  await strategy.apply(srcFile, destFile, TEST_FILE, context);

  expect(recorded).toEqual({ path: TEST_FILE, strategy: "copy-overwrite" });
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:151-167`

## Tagged-Merge Strategy Test Organization

The most complex strategy (tagged-merge) is organized into logical test groups:

### Test Organization

```typescript
describe("TaggedMergeStrategy", () => {
  // Setup and context creation...

  // Core behavior tests
  describe("core behavior", () => {
    it("has correct name", () => { /* ... */ });
    it("copies file when destination does not exist", () => { /* ... */ });
    it("backs up file before merging", () => { /* ... */ });
    it("calls recordFile for processed files", () => { /* ... */ });
    it("skips when no changes detected", () => { /* ... */ });
    it("respects dry-run mode", () => { /* ... */ });
  });

  // Force behavior tests
  describe("force behavior", () => {
    it("replaces force section with Lisa version", () => { /* ... */ });
    it("preserves tag structure in force sections", () => { /* ... */ });
    it("handles multiple force sections", () => { /* ... */ });
    it("preserves untagged content from project", () => { /* ... */ });
  });

  // Defaults behavior tests
  describe("defaults behavior", () => {
    it("preserves project content in defaults section", () => { /* ... */ });
    it("uses Lisa content when project has no defaults section", () => { /* ... */ });
    it("handles empty defaults section in project", () => { /* ... */ });
  });

  // Array merge behavior tests
  describe("array merge behavior", () => {
    it("combines arrays from Lisa and project without duplicates", () => { /* ... */ });
    it("deduplicates array items by JSON value", () => { /* ... */ });
    it("handles object items in merge arrays", () => { /* ... */ });
    it("preserves array order with Lisa items first", () => { /* ... */ });
  });

  // Complex scenarios
  describe("complex scenarios", () => {
    it("handles mixed behaviors in single file", () => { /* ... */ });
    it("preserves order from Lisa template with untagged content", () => { /* ... */ });
    it("handles deeply nested tagged structures", () => { /* ... */ });
  });

  // Edge cases
  describe("edge cases", () => {
    it("handles empty JSON objects", () => { /* ... */ });
    it("handles files with only tags", () => { /* ... */ });
    it("handles null and undefined values gracefully", () => { /* ... */ });
    it("handles string keys that look like tags but aren't", () => { /* ... */ });
    it("handles files with duplicate item deduplication", () => { /* ... */ });
  });

  // File operation tests
  describe("file operations", () => {
    it("records files in manifest correctly", () => { /* ... */ });
    it("returns correct action types", () => { /* ... */ });
  });
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:10-781`

**Key aspects**:
- Nested describe blocks for logical grouping (6 main sections)
- 30 test cases total
- Each section tests a specific aspect of behavior
- Edge cases tested comprehensively

### ESLint Configuration for Large Tests

Tagged-merge test file disables ESLint for file size and duplication:

```typescript
/* eslint-disable max-lines,sonarjs/no-duplicate-string -- Comprehensive test suite requires extensive test cases with repeated fixtures */
// ... test code ...
/* eslint-enable max-lines,sonarjs/no-duplicate-string -- End of test suite */
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:1, 782`

**Rationale**: The suite has many test fixtures with repeated patterns (multiple test tags, multiple merge scenarios), and the comprehensive nature justifies the size.

## Common Test Patterns by Strategy

### Pattern 1: Basic File Operations

Applicable to all strategies (core behavior):

```typescript
it("has correct name", () => {
  expect(strategy.name).toBe("strategy-name");
});

it("copies file when destination does not exist", async () => {
  const srcFile = path.join(srcDir, filename);
  const destFile = path.join(destDir, filename);
  await fs.writeFile(srcFile, "content");

  const result = await strategy.apply(
    srcFile,
    destFile,
    filename,
    createContext()
  );

  expect(result.action).toBe("copied");
  expect(await fs.pathExists(destFile)).toBe(true);
});

it("skips when files are identical", async () => {
  const srcFile = path.join(srcDir, filename);
  const destFile = path.join(destDir, filename);
  const content = "same content";
  await fs.writeFile(srcFile, content);
  await fs.writeFile(destFile, content);

  const result = await strategy.apply(
    srcFile,
    destFile,
    filename,
    createContext()
  );

  expect(result.action).toBe("skipped");
});
```

### Pattern 2: Dry-Run Mode Testing

All strategies test that dry-run doesn't modify files:

```typescript
it("does not modify files in dry run mode", async () => {
  const srcFile = path.join(srcDir, filename);
  const destFile = path.join(destDir, filename);
  await fs.writeFile(srcFile, "new content");
  await fs.writeFile(destFile, "old content");

  const originalContent = await fs.readFile(destFile, "utf-8");
  const result = await strategy.apply(
    srcFile,
    destFile,
    filename,
    createContext({ dryRun: true })
  );

  // Action is reported but file is unchanged
  const finalContent = await fs.readFile(destFile, "utf-8");
  expect(finalContent).toEqual(originalContent);
  // Result still shows what would happen
  expect(result.action).toBe("overwritten"); // or "merged" depending on strategy
});
```

**Found in**:
- `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:139-161`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:184-215`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-contents.test.ts:208-226`
- `/Users/cody/workspace/lisa/tests/unit/strategies/create-only.test.ts:154-168`

### Pattern 3: Manifest Recording

Tests verify files are recorded for manifest tracking:

```typescript
it("records file in manifest correctly", async () => {
  const srcFile = path.join(srcDir, filename);
  const destFile = path.join(destDir, filename);
  await fs.writeFile(srcFile, "content");
  await fs.writeFile(destFile, "existing");

  let recordedPath = "";
  let recordedStrategy = "";
  const context = {
    ...createContext(),
    recordFile: (path: string, strategy: string) => {
      recordedPath = path;
      recordedStrategy = strategy;
    },
  };

  await strategy.apply(srcFile, destFile, filename, context);

  expect(recordedPath).toBe(filename);
  expect(recordedStrategy).toBe("tagged-merge");
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:723-743`

### Pattern 4: Backup Verification

Tests verify backup is called before modifications:

```typescript
it("backs up file before merging", async () => {
  const srcFile = path.join(srcDir, filename);
  const destFile = path.join(destDir, filename);
  await fs.writeFile(srcFile, "new");
  await fs.writeFile(destFile, "existing");

  let backupCalled = false;
  const context = {
    ...createContext(),
    backupFile: async () => {
      backupCalled = true;
    },
  };

  await strategy.apply(srcFile, destFile, filename, context);

  expect(backupCalled).toBe(true);
});
```

**Found in**:
- `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:132-149`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-overwrite.test.ts:114-132`
- `/Users/cody/workspace/lisa/tests/unit/strategies/copy-contents.test.ts:186-206`
- `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:78-100`

## Copy-Contents Marker Pattern

The copy-contents strategy has unique marker-based tests:

```typescript
it("replaces block when markers exist in destination", async () => {
  const srcFile = path.join(srcDir, GITIGNORE);
  const destFile = path.join(destDir, GITIGNORE);
  const sourceContent = `${BEGIN_MARKER}\ndist\ncoverage\n${END_MARKER}`;
  const destContent = `# My custom entries\nmy-dir\n${BEGIN_MARKER}\nold-entry\n${END_MARKER}\n# End\n`;

  await fs.writeFile(srcFile, sourceContent);
  await fs.writeFile(destFile, destContent);

  const result = await strategy.apply(
    srcFile,
    destFile,
    GITIGNORE,
    createContext()
  );

  expect(result.action).toBe("merged");

  const content = await fs.readFile(destFile, "utf-8");
  expect(content).toContain("# My custom entries"); // Preserved
  expect(content).toContain("my-dir"); // Preserved
  expect(content).toContain("dist"); // From source
  expect(content).toContain("coverage"); // From source
  expect(content).not.toContain("old-entry"); // Replaced
});

it("appends when markers do not exist in destination", async () => {
  const srcFile = path.join(srcDir, GITIGNORE);
  const destFile = path.join(destDir, GITIGNORE);
  const sourceContent = `${BEGIN_MARKER}\nnode_modules\ndist\n${END_MARKER}`;
  const destContent = "# My custom entries\nmy-dir\n";

  await fs.writeFile(srcFile, sourceContent);
  await fs.writeFile(destFile, destContent);

  const result = await strategy.apply(
    srcFile,
    destFile,
    GITIGNORE,
    createContext()
  );

  expect(result.action).toBe("merged");

  const content = await fs.readFile(destFile, "utf-8");
  expect(content).toContain("# My custom entries");
  expect(content).toContain("my-dir");
  expect(content).toContain(sourceContent);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/copy-contents.test.ts:94-143`

## Merge Strategy JSON Tests

The merge strategy tests deep merge behavior:

```typescript
it("deep merges objects with Lisa values taking precedence", async () => {
  const srcFile = path.join(srcDir, PACKAGE_JSON);
  const destFile = path.join(destDir, PACKAGE_JSON);

  await fs.writeJson(srcFile, {
    scripts: { test: "vitest", build: "tsc" },
    devDependencies: { vitest: "^1.0.0" },
  });

  await fs.writeJson(destFile, {
    name: "my-project",
    scripts: { build: "rollup" },
  });

  const result = await strategy.apply(
    srcFile,
    destFile,
    PACKAGE_JSON,
    createContext()
  );

  expect(result.action).toBe("merged");

  const content = await fs.readJson(destFile);
  expect(content).toEqual({
    name: "my-project",
    scripts: {
      test: "vitest",
      build: "tsc",
    },
    devDependencies: { vitest: "^1.0.0" },
  });
});

it("handles arrays (merges by index)", async () => {
  const srcFile = path.join(srcDir, CONFIG_JSON);
  const destFile = path.join(destDir, CONFIG_JSON);

  await fs.writeJson(srcFile, { plugins: ["a", "b"] });
  await fs.writeJson(destFile, { plugins: ["c"] });

  await strategy.apply(srcFile, destFile, CONFIG_JSON, createContext());

  const content = await fs.readJson(destFile);
  expect(content.plugins).toEqual(["a", "b"]);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:79-187`

## Tagged-Merge Strategy Complex Tests

### Force Behavior

```typescript
it("replaces force section with Lisa version", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  // Lisa provides enforced values
  await fs.writeJson(srcFile, {
    "//lisa-force-scripts": "Required scripts",
    scripts: {
      test: "vitest",
      build: "tsc",
    },
    "//end-lisa-force-scripts": "",
  });

  // Project has different values
  await fs.writeJson(destFile, {
    "//lisa-force-scripts": "Required scripts",
    scripts: {
      test: "jest",
      build: "rollup",
      custom: "custom-build",
    },
    "//end-lisa-force-scripts": "",
  });

  const result = await strategy.apply(
    srcFile,
    destFile,
    "package.json",
    createContext()
  );

  expect(result.action).toBe("merged");

  const content = await fs.readJson(destFile);
  expect(content.scripts).toEqual({
    test: "vitest",
    build: "tsc",
  });
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:166-205`

### Defaults Behavior

```typescript
it("uses Lisa content when project has no defaults section", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  await fs.writeJson(srcFile, {
    "//lisa-defaults-engines": "Default engines",
    engines: {
      node: "18.x",
      npm: "please-use-bun",
    },
    "//end-lisa-defaults-engines": "",
  });

  await fs.writeJson(destFile, {
    name: "my-project",
  });

  await strategy.apply(srcFile, destFile, "package.json", createContext());

  const content = await fs.readJson(destFile);
  expect(content.engines.node).toBe("18.x");
  expect(content.engines.npm).toBe("please-use-bun");
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:329-351`

### Array Merge Behavior

```typescript
it("deduplicates array items by JSON value", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  await fs.writeJson(srcFile, {
    "//lisa-merge-deps": "Dependencies",
    deps: ["a", "b"],
    "//end-lisa-merge-deps": "",
  });

  await fs.writeJson(destFile, {
    "//lisa-merge-deps": "Dependencies",
    deps: ["b", "c"],
    "//end-lisa-merge-deps": "",
  });

  await strategy.apply(srcFile, destFile, "package.json", createContext());

  const content = await fs.readJson(destFile);
  expect(content.deps).toEqual(["a", "b", "c"]);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:409-430`

### Mixed Behaviors

```typescript
it("handles mixed behaviors in single file", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  await fs.writeJson(srcFile, {
    "//lisa-force-scripts": "Required",
    scripts: { test: "vitest" },
    "//end-lisa-force-scripts": "",
    "//lisa-defaults-engines": "Defaults",
    engines: { node: "18.x" },
    "//end-lisa-defaults-engines": "",
    "//lisa-merge-deps": "Merge",
    deps: ["a"],
    "//end-lisa-merge-deps": "",
  });

  await fs.writeJson(destFile, {
    "//lisa-force-scripts": "Required",
    scripts: { test: "jest", custom: "value" },
    "//end-lisa-force-scripts": "",
    "//lisa-defaults-engines": "Defaults",
    engines: { node: "20.x" },
    "//end-lisa-defaults-engines": "",
    "//lisa-merge-deps": "Merge",
    deps: ["b"],
    "//end-lisa-merge-deps": "",
  });

  await strategy.apply(srcFile, destFile, "package.json", createContext());

  const content = await fs.readJson(destFile);
  // Force: Lisa wins
  expect(content.scripts).toEqual({ test: "vitest" });
  // Defaults: Project wins
  expect(content.engines.node).toBe("20.x");
  // Merge: Combined
  expect(content.deps).toEqual(["a", "b"]);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:484-521`

### Edge Cases

```typescript
it("handles string keys that look like tags but aren't", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  await fs.writeJson(srcFile, {
    "//notAtag": "value1",
    "//lisa-force-valid": "valid",
    key: "content",
    "//end-lisa-force-valid": "",
  });

  await fs.writeJson(destFile, {
    "//notAtag": "oldvalue",
    "//lisa-force-valid": "valid",
    key: "oldcontent",
    "//end-lisa-force-valid": "",
    custom: "custom-value",
  });

  const result = await strategy.apply(
    srcFile,
    destFile,
    "package.json",
    createContext()
  );

  expect(result.action).toBe("merged");

  const content = await fs.readJson(destFile);
  expect(content.key).toBe("content");
  expect(content.custom).toBe("custom-value");
  expect(content["//notAtag"]).toBe("value1");
});

it("handles files with duplicate item deduplication", async () => {
  const srcFile = path.join(srcDir, "package.json");
  const destFile = path.join(destDir, "package.json");

  await fs.writeJson(srcFile, {
    "//lisa-merge-list": "list",
    list: ["a", "b", "a"],
    "//end-lisa-merge-list": "",
  });

  await fs.writeJson(destFile, {
    "//lisa-merge-list": "list",
    list: ["b", "c"],
    "//end-lisa-merge-list": "",
  });

  await strategy.apply(srcFile, destFile, "package.json", createContext());

  const content = await fs.readJson(destFile);
  expect(content.list).toEqual(["a", "b", "c"]);
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/tagged-merge.test.ts:659-718`

## Error Handling Tests

Merge strategy tests JSON parsing errors:

```typescript
it("throws error for invalid source JSON", async () => {
  const srcFile = path.join(srcDir, INVALID_JSON);
  const destFile = path.join(destDir, INVALID_JSON);
  await fs.writeFile(srcFile, "not valid json");
  await fs.writeJson(destFile, { valid: true });

  await expect(
    strategy.apply(srcFile, destFile, INVALID_JSON, createContext())
  ).rejects.toThrow();
});

it("throws error for invalid destination JSON", async () => {
  const srcFile = path.join(srcDir, VALID_JSON);
  const destFile = path.join(destDir, INVALID_JSON);
  await fs.writeJson(srcFile, { valid: true });
  await fs.writeFile(destFile, "not valid json");

  await expect(
    strategy.apply(srcFile, destFile, INVALID_JSON, createContext())
  ).rejects.toThrow();
});
```

**Found in**: `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts:207-227`

## Test Count Summary by Strategy

| Strategy | Test File | Total Tests | Organization |
|----------|-----------|-------------|--------------|
| tagged-merge | tagged-merge.test.ts | 30 | 6 nested describe blocks |
| merge | merge.test.ts | 10 | Flat describe with 10 its |
| copy-overwrite | copy-overwrite.test.ts | 10 | Flat describe with 10 its |
| copy-contents | copy-contents.test.ts | 9 | Flat describe with 9 its |
| create-only | create-only.test.ts | 7 | Flat describe with 7 its |

## Key Takeaways for Package-Lisa Testing

1. **Setup/Teardown**: Use `createTempDir()` in beforeEach and `cleanupTempDir()` in afterEach
2. **Context**: Always create mock context with `createContext()` helper, override config as needed
3. **AAA Pattern**: Arrange test data, Act on strategy, Assert results
4. **File Operations**: Use fs-extra for writeFile, writeJson, readFile, readJson, pathExists
5. **Mocking**: Mock recordFile, backupFile, promptOverwrite to verify calls
6. **Organization**: For complex strategies, use nested describe blocks to group related tests
7. **Constants**: Define file names and content patterns as constants
8. **ESLint**: Use eslint-disable for max-lines/sonarjs/no-duplicate-string in large test suites
9. **Assertions**: Check both result.action and actual file content/state
10. **Dry-Run**: Always test that dryRun mode doesn't modify files but still reports action

## Integration Testing

While not shown here, integration tests would be in `/Users/cody/workspace/lisa/tests/integration/` and would test strategies in the context of full Lisa operations, manifest tracking, and multi-strategy scenarios.
