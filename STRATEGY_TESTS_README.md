# Strategy Tests - Complete Documentation

This directory contains four comprehensive guides for understanding and writing strategy tests in the Lisa codebase.

## Documents Overview

### 1. STRATEGY_TEST_PATTERNS.md
**Main reference guide for understanding existing test patterns**

Contains:
- Complete catalog of all 66 tests across 5 strategies
- Test organization by strategy
- File operation patterns (setup, teardown, temporary files)
- Arrange-act-assert patterns with real examples
- Test data patterns and conventions
- Mock patterns for context functions
- Tagged-merge complex test examples
- Error handling patterns
- Test count summary

**Use this to**: Understand how tests are currently structured and what patterns are established.

### 2. STRATEGY_TEST_TEMPLATE.md
**Ready-to-use template for writing new strategy tests**

Contains:
- Complete test file template with all sections
- For simple strategies (flat tests)
- For complex strategies (nested describe blocks)
- Minimal test count guidelines
- Common assertions reference
- Key testing principles
- Running tests examples
- Integration test patterns

**Use this to**: Start writing tests for a new strategy (copy and fill in the blanks).

### 3. STRATEGY_TESTS_VISUAL_GUIDE.md
**Visual diagrams and flow charts**

Contains:
- File organization tree
- Test execution flow diagrams
- Context mock structure
- File operation lifecycle
- Test data flow
- Mock capture patterns (3 types)
- Dry-run testing pattern
- Assertion matrix
- Tagged-merge test organization
- Coverage statistics
- Setup sequence diagrams
- Key invariants

**Use this to**: Visualize how tests work and understand the overall structure.

### 4. STRATEGY_TESTS_COPY_PASTE.md
**Ready-to-copy code snippets**

Contains:
- Setup boilerplate (imports, describe, beforeEach, afterEach)
- Context creation helper
- 12+ individual test snippets for common scenarios
- Edge case tests
- Text file tests (.gitignore patterns)
- JSON merge tests
- Tagged section tests
- Context override examples
- Assertion patterns reference
- Complete minimal test example

**Use this to**: Copy code snippets directly into your test file.

## Quick Start for Writing Package-Lisa Tests

1. **Review the patterns**: Start with STRATEGY_TEST_PATTERNS.md to see how existing tests are organized
2. **Get the template**: Copy STRATEGY_TEST_TEMPLATE.md as your base
3. **Add test snippets**: Use STRATEGY_TESTS_COPY_PASTE.md for specific test implementations
4. **Check the visuals**: Refer to STRATEGY_TESTS_VISUAL_GUIDE.md if you're confused about flow
5. **Run the tests**: Use `npm test tests/unit/strategies/your-strategy.test.ts`

## Existing Test Statistics

```
Strategy          File                   Lines  Tests
─────────────────────────────────────────────────────
tagged-merge      tagged-merge.test.ts   782    30
merge             merge.test.ts          228    10
copy-overwrite    copy-overwrite.test.ts 216    10
copy-contents     copy-contents.test.ts  269    9
create-only       create-only.test.ts    169    7
─────────────────────────────────────────────────────
TOTAL                                  1,664   66
```

## Test Patterns at a Glance

### Structure
- Setup/teardown with temporary directories
- Context creation helper with mock functions
- Flat or nested describe blocks
- Arrange-act-assert test pattern

### Coverage
- Core behavior (4-6 tests)
- File operations (3-4 tests)
- Strategy-specific logic (3-5 tests)
- Edge cases (3-5 tests)
- Dry-run mode (always tested)

### Tools
- Jest for test framework
- fs-extra for file operations
- Mock functions for context callbacks
- Temporary directories for isolation

### Best Practices
1. No shared state between tests
2. No test fixtures (inline data)
3. One behavior per test
4. Check both result AND file state
5. Always mock context functions
6. Proper cleanup (automatic)

## Test File Locations

```
tests/unit/strategies/
├── tagged-merge.test.ts
├── merge.test.ts
├── copy-overwrite.test.ts
├── copy-contents.test.ts
└── create-only.test.ts

tests/helpers/
└── test-utils.ts  (createTempDir, cleanupTempDir)

src/strategies/
├── strategy.interface.ts  (StrategyContext interface)
├── tagged-merge.ts
├── merge.ts
├── copy-overwrite.ts
├── copy-contents.ts
└── create-only.ts
```

## Running Tests

```bash
# All strategy tests
npm test tests/unit/strategies/

# Specific strategy
npm test tests/unit/strategies/tagged-merge.test.ts

# Watch mode
npm run test:watch tests/unit/strategies/

# With coverage
npm run test:cov -- tests/unit/strategies/
```

## Key Interfaces

### StrategyContext
```typescript
interface StrategyContext {
  config: LisaConfig
  recordFile: (relativePath: string, strategy: string) => void
  backupFile: (absolutePath: string) => Promise<void>
  promptOverwrite: (path: string, src: string, dest: string) => Promise<boolean>
}
```

### FileOperationResult
```typescript
{
  action: "copied" | "skipped" | "merged" | "overwritten" | "created"
}
```

## Common Test Assertions

```typescript
// Actions
expect(result.action).toBe("copied")
expect(result.action).toBe("skipped")
expect(result.action).toBe("merged")

// File state
expect(await fs.pathExists(destFile)).toBe(true)
expect(await fs.readJson(destFile)).toEqual(expected)

// Mocks
expect(backupCalled).toBe(true)
expect(recordedPath).toBe("file.json")

// Errors
await expect(strategy.apply(...)).rejects.toThrow()
```

## Writing Your First Strategy Test

### Step 1: Create the test file
```
cp tests/unit/strategies/copy-overwrite.test.ts \
   tests/unit/strategies/your-strategy.test.ts
```

### Step 2: Update imports and names
```typescript
import { YourStrategy } from "../../../src/strategies/your-strategy.js";

describe("YourStrategy", () => {
  let strategy: YourStrategy;
  // ...
```

### Step 3: Add your tests
Use STRATEGY_TESTS_COPY_PASTE.md snippets for specific tests.

### Step 4: Run tests
```bash
npm test tests/unit/strategies/your-strategy.test.ts
```

## Test Patterns by Complexity

### Simple Strategies (copy-overwrite, create-only)
- 7-10 tests
- Flat describe structure
- Tests for:
  - Correct name
  - Copy/create behavior
  - Skip when identical
  - Dry-run mode
  - Backup/recording
  - Parent directory creation

### Medium Strategies (merge, copy-contents)
- 9-10 tests
- Flat describe structure
- Tests for:
  - All simple tests
  - Plus strategy-specific logic (merge, append)
  - Edge cases

### Complex Strategies (tagged-merge)
- 25+ tests
- Nested describe blocks (6-7 groups)
- Tests for:
  - All previous patterns
  - Multiple behaviors (force, defaults, merge)
  - Complex scenarios
  - Comprehensive edge cases

## Recommended Test Count for Package-Lisa

Based on complexity analysis:
- **Minimum**: 13-15 tests
- **Recommended**: 18-22 tests
- **Comprehensive**: 25+ tests

Suggested organization:
```
describe("PackageLisaStrategy", () => {
  describe("core behavior", () => { /* 5 tests */ })
  describe("package.json merging", () => { /* 4 tests */ })
  describe("version resolution", () => { /* 3 tests */ })
  describe("file operations", () => { /* 3 tests */ })
  describe("edge cases", () => { /* 3 tests */ })
})
```

## Debugging Tests

### Run single test
```bash
npm test -- -t "has correct name"
```

### Run with detailed output
```bash
npm test -- --verbose
```

### Watch mode for development
```bash
npm run test:watch tests/unit/strategies/your-strategy.test.ts
```

### Check coverage for specific file
```bash
npm run test:cov -- tests/unit/strategies/your-strategy.test.ts
```

## Next Steps

1. Read STRATEGY_TEST_PATTERNS.md for comprehensive understanding
2. Review STRATEGY_TESTS_VISUAL_GUIDE.md for structure clarity
3. Copy snippets from STRATEGY_TESTS_COPY_PASTE.md
4. Use STRATEGY_TEST_TEMPLATE.md as starting structure
5. Write your tests
6. Run `npm test` to verify
7. Check coverage with `npm run test:cov`

## Additional Resources

- Jest documentation: https://jestjs.io/
- fs-extra documentation: https://github.com/jprichardson/node-fs-extra
- Node.js path module: https://nodejs.org/api/path.html

---

**Last Updated**: 2026-01-28
**Total Test Coverage**: 66 tests across 5 strategies, 1,664 lines of test code
