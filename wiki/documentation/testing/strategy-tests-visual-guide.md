# Strategy Tests - Visual Reference Guide

## Test File Organization

```
tests/unit/strategies/
├── tagged-merge.test.ts          ← Most complex (782 lines, 30 tests)
│   ├── setup/teardown
│   ├── context creation helper
│   └── 6 describe blocks:
│       ├── "core behavior" (6 tests)
│       ├── "force behavior" (4 tests)
│       ├── "defaults behavior" (3 tests)
│       ├── "array merge behavior" (4 tests)
│       ├── "complex scenarios" (3 tests)
│       ├── "edge cases" (5 tests)
│       └── "file operations" (2 tests)
│
├── copy-overwrite.test.ts        ← Simple (216 lines, 10 tests)
│   ├── setup/teardown
│   ├── context creation helper
│   └── 1 describe block (flat tests)
│
├── merge.test.ts                 ← Simple (228 lines, 10 tests)
│   ├── setup/teardown
│   ├── context creation helper
│   └── 1 describe block (flat tests)
│
├── copy-contents.test.ts         ← Simple (269 lines, 9 tests)
│   ├── setup/teardown
│   ├── context creation helper
│   └── 1 describe block (flat tests)
│
└── create-only.test.ts           ← Simple (169 lines, 7 tests)
    ├── setup/teardown
    ├── context creation helper
    └── 1 describe block (flat tests)
```

## Test Execution Flow

```
describe("StrategyName", () => {
  │
  ├─ beforeEach()
  │  ├─ strategy = new StrategyName()
  │  ├─ tempDir = await createTempDir()
  │  ├─ srcDir = path.join(tempDir, "src")
  │  ├─ destDir = path.join(tempDir, "dest")
  │  ├─ await fs.ensureDir(srcDir)
  │  └─ await fs.ensureDir(destDir)
  │
  ├─ it("test 1", async () => {
  │  ├─ ARRANGE: Set up files
  │  │  ├─ srcFile = path.join(srcDir, "test.json")
  │  │  ├─ destFile = path.join(destDir, "test.json")
  │  │  ├─ await fs.writeJson(srcFile, {...})
  │  │  └─ await fs.writeJson(destFile, {...})
  │  │
  │  ├─ ACT: Execute strategy
  │  │  └─ result = await strategy.apply(srcFile, destFile, "test.json", context)
  │  │
  │  └─ ASSERT: Verify behavior
  │     ├─ expect(result.action).toBe("merged")
  │     └─ expect(await fs.readJson(destFile)).toEqual(expected)
  │
  ├─ it("test 2", async () => { /* ... */ })
  ├─ it("test 3", async () => { /* ... */ })
  │
  └─ afterEach()
     └─ await cleanupTempDir(tempDir)
```

## Context Mock Structure

```
createContext(overrides = {})
│
├─ config: LisaConfig
│  ├─ lisaDir: srcDir
│  ├─ destDir: destDir
│  ├─ dryRun: false (or override)
│  ├─ yesMode: true (or override)
│  ├─ validateOnly: false (or override)
│  └─ ...overrides
│
└─ return StrategyContext
   ├─ config
   ├─ recordFile: () => {} (mockable)
   ├─ backupFile: async () => {} (mockable)
   └─ promptOverwrite: async () => true (mockable)
```

## File Operation Lifecycle

```
Test Starts
│
├─ Create temp directory (srcDir, destDir)
│
├─ Write test files
│  ├─ srcFile: fs.writeJson(srcFile, lisaContent)
│  └─ destFile: fs.writeJson(destFile, projectContent)
│
├─ Create mock context
│  ├─ Override recordFile if testing manifest
│  ├─ Override backupFile if testing backup
│  └─ Override promptOverwrite if testing decisions
│
├─ Execute strategy
│  └─ await strategy.apply(srcFile, destFile, relativePath, context)
│
├─ Verify results
│  ├─ Check result.action
│  ├─ Check actual file content
│  ├─ Check mock calls (if any)
│  └─ Check directory structure (if needed)
│
├─ Clean up (automatic)
│  └─ afterEach calls cleanupTempDir(tempDir)
│
└─ Test Ends
```

## Test Data Flow

```
Constants (top of file):
┌──────────────────────────────────┐
│ const PACKAGE_JSON = "package.json"
│ const SETTINGS = { ... }
│ const CONTENT_A = { ... }
│ const CONTENT_B = { ... }
└──────────────────────────────────┘
         │
         ↓ (used in)
┌──────────────────────────────────┐
│ it("test name", async () => {   │
│   const srcFile = ...            │
│   await fs.writeJson(srcFile,   │
│     CONTENT_A                    │
│   )                              │
└──────────────────────────────────┘
         │
         ↓ (compared against)
┌──────────────────────────────────┐
│ expect(result).toEqual(expected) │
│ expect(content).toBe(CONTENT_A)  │
└──────────────────────────────────┘
```

## Mock Capture Patterns

### Pattern 1: Boolean Capture
```
let backupCalled = false
const context = {
  ...createContext(),
  backupFile: async () => {
    backupCalled = true          ← Captured
  }
}
await strategy.apply(...)
expect(backupCalled).toBe(true)  ← Asserted
```

### Pattern 2: Argument Capture
```
let recordedPath = ""
const context = {
  ...createContext(),
  recordFile: (path: string) => {
    recordedPath = path           ← Captured
  }
}
await strategy.apply(...)
expect(recordedPath).toBe("file.json")  ← Asserted
```

### Pattern 3: Return Override
```
const context = {
  ...createContext(),
  promptOverwrite: async () => false  ← Different return
}
await strategy.apply(...)
// Strategy behaves differently based on false return
expect(result.action).toBe("skipped")
```

## Dry-Run Testing Pattern

```
Test Setup:
┌─────────────────┐
│ srcFile: NEW    │
│ destFile: OLD   │
└─────────────────┘
         │
         ↓
Call with dryRun: true
         │
         ↓
Check 1: File Unchanged
┌─────────────────┐
│ destFile: OLD   │  ← Still OLD
└─────────────────┘
         │
         ↓
Check 2: Action Reported
┌─────────────────────┐
│ result.action:      │
│ "merged"            │  ← Still reported
└─────────────────────┘
```

## Assertion Matrix

```
Result Checks:
├─ result.action
│  ├─ "copied" (dest doesn't exist)
│  ├─ "skipped" (files identical)
│  ├─ "merged" (JSON deep merge)
│  ├─ "overwritten" (replaced file)
│  └─ "created" (create-only)
│
File Existence:
├─ fs.pathExists(destFile) → true/false
├─ fs.pathExists(dir) → true/false
│
Content Checks:
├─ fs.readFile(destFile, "utf-8") → string
├─ fs.readJson(destFile) → object
│
Mock Checks:
├─ backupCalled → boolean
├─ recordedPath → string
├─ recordedStrategy → string
│
Error Checks:
└─ expect(...).rejects.toThrow()
```

## Tagged-Merge Test Organization

```
TaggedMergeStrategy Tests (30 total):
│
├─ "core behavior" (6)
│  ├─ has correct name
│  ├─ copies when dest doesn't exist
│  ├─ backs up before merging
│  ├─ calls recordFile
│  ├─ skips when no changes
│  └─ respects dry-run mode
│
├─ "force behavior" (4)
│  ├─ replaces force section with Lisa version
│  ├─ preserves tag structure
│  ├─ handles multiple force sections
│  └─ preserves untagged content
│
├─ "defaults behavior" (3)
│  ├─ preserves project content in defaults
│  ├─ uses Lisa content when no defaults
│  └─ handles empty defaults section
│
├─ "array merge behavior" (4)
│  ├─ combines arrays without duplicates
│  ├─ deduplicates by JSON value
│  ├─ handles object items in arrays
│  └─ preserves array order
│
├─ "complex scenarios" (3)
│  ├─ mixed behaviors in single file
│  ├─ preserves order from template
│  └─ handles deeply nested structures
│
├─ "edge cases" (5)
│  ├─ empty JSON objects
│  ├─ files with only tags
│  ├─ null and undefined values
│  ├─ keys that look like tags
│  └─ duplicate item deduplication
│
└─ "file operations" (2)
   ├─ records files in manifest correctly
   └─ returns correct action types
```

## Test Coverage by Strategy

```
Strategy          Lines  Tests  Tests/100 lines
──────────────────────────────────────────────
tagged-merge      782    30     3.8
copy-overwrite    216    10     4.6
merge             228    10     4.4
copy-contents     269    9      3.3
create-only       169    7      4.1
──────────────────────────────────────────────
TOTAL           1,664    66     4.0
```

## File Setup Sequence

```
beforeEach()
│
├─ new StrategyName()
│  └─ strategy instance ready
│
├─ createTempDir()
│  └─ /tmp/lisa-test-XXXXX/
│
├─ mkdir src/
│  └─ /tmp/lisa-test-XXXXX/src/
│
├─ mkdir dest/
│  └─ /tmp/lisa-test-XXXXX/dest/
│
└─ Test Ready
   ├─ strategy = StrategyName
   ├─ srcDir = /tmp/lisa-test-XXXXX/src/
   ├─ destDir = /tmp/lisa-test-XXXXX/dest/
   └─ Empty subdirectories


Test Execution
│
├─ fs.writeJson(srcDir/file.json, data1)
├─ fs.writeJson(destDir/file.json, data2)
├─ strategy.apply(...)
├─ fs.readJson(destDir/file.json) ← verify
│
└─ Clean up


afterEach()
│
├─ Check tempDir exists
├─ fs.remove(tempDir)
│  └─ Recursively delete
│     /tmp/lisa-test-XXXXX/
│
└─ Test Complete
```

## Strategy Application Call

```
await strategy.apply(
  srcFile,          ← Absolute path to source file
  destFile,         ← Absolute path to destination file
  relativePath,     ← "package.json" or "nested/file.json"
  context           ← StrategyContext with config + mocks
)

Returns:
{
  action: "copied" | "skipped" | "merged" | "overwritten" | "created"
}
```

## Common Test Pattern Structure

```
describe("StrategyName", () => {
  // 1. Instance & Directories
  let strategy: StrategyName
  let tempDir: string
  let srcDir: string
  let destDir: string

  // 2. Setup
  beforeEach(async () => { ... })

  // 3. Context Helper
  function createContext(overrides = {}) { ... }

  // 4. Test Groups (1-6 describe blocks)
  describe("core behavior", () => {
    it("has correct name", () => { ... })
    it("copies when dest missing", () => { ... })
    // ... more tests
  })

  describe("edge cases", () => {
    it("handles empty objects", () => { ... })
    // ... more tests
  })

  // 5. Cleanup
  afterEach(async () => { ... })
})
```

## Key Invariants

```
✓ Every test has unique temp dirs
✓ Every test cleans up after itself
✓ Context is created fresh per test
✓ Mocks are isolated per test
✓ Files are created inline, not in fixtures
✓ Assertions check both result AND file state
✓ Dry-run always verified
✓ Error handling tested where applicable
✓ No shared state between tests
✓ Test names describe the behavior being tested
```
