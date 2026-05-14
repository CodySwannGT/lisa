# Strategy Test Template

Use this template as a starting point for writing tests for new strategies (like package-lisa).

## Basic Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { YourStrategyName } from "../../../src/strategies/your-strategy.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

// Constants for test data
const TEST_FILE = "test-file.json";
const LISA_CONTENT = { /* sample Lisa data */ };
const PROJECT_CONTENT = { /* sample project data */ };

describe("YourStrategyName", () => {
  let strategy: YourStrategyName;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  /**
   * Setup: Create temporary directories and strategy instance
   */
  beforeEach(async () => {
    strategy = new YourStrategyName();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  /**
   * Teardown: Clean up temporary directories
   */
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

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

  // ===== Core Behavior Tests =====
  describe("core behavior", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe("your-strategy");
    });

    it("copies file when destination does not exist", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, LISA_CONTENT);

      const result = await strategy.apply(
        srcFile,
        destFile,
        TEST_FILE,
        createContext()
      );

      expect(result.action).toBe("copied");
      expect(await fs.pathExists(destFile)).toBe(true);
      const content = await fs.readJson(destFile);
      expect(content).toEqual(LISA_CONTENT);
    });

    it("skips when files are identical", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      const content = { same: "content" };
      await fs.writeJson(srcFile, content);
      await fs.writeJson(destFile, content);

      const result = await strategy.apply(
        srcFile,
        destFile,
        TEST_FILE,
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("respects dry-run mode", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, { new: "value" });
      await fs.writeJson(destFile, { old: "value" });

      const originalContent = await fs.readJson(destFile);

      const result = await strategy.apply(
        srcFile,
        destFile,
        TEST_FILE,
        createContext({ dryRun: true })
      );

      // File should not be modified
      const finalContent = await fs.readJson(destFile);
      expect(finalContent).toEqual(originalContent);
      // But action should be reported
      expect(result.action).toBeTruthy();
    });
  });

  // ===== File Operation Tests =====
  describe("file operations", () => {
    it("backs up file before modifying", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, { new: "value" });
      await fs.writeJson(destFile, { old: "value" });

      let backupCalled = false;
      const context = {
        ...createContext(),
        backupFile: async () => {
          backupCalled = true;
        },
      };

      await strategy.apply(srcFile, destFile, TEST_FILE, context);

      expect(backupCalled).toBe(true);
    });

    it("records file in manifest", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, LISA_CONTENT);

      let recordedPath = "";
      let recordedStrategy = "";
      const context = {
        ...createContext(),
        recordFile: (path: string, strategy: string) => {
          recordedPath = path;
          recordedStrategy = strategy;
        },
      };

      await strategy.apply(srcFile, destFile, TEST_FILE, context);

      expect(recordedPath).toBe(TEST_FILE);
      expect(recordedStrategy).toBe("your-strategy");
    });

    it("creates parent directories when needed", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, "nested", "deep", TEST_FILE);
      await fs.writeJson(srcFile, LISA_CONTENT);

      await strategy.apply(
        srcFile,
        destFile,
        `nested/deep/${TEST_FILE}`,
        createContext()
      );

      expect(await fs.pathExists(destFile)).toBe(true);
    });
  });

  // ===== Strategy-Specific Behavior Tests =====
  describe("strategy-specific behavior", () => {
    it("applies your-strategy-specific logic", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, LISA_CONTENT);
      await fs.writeJson(destFile, PROJECT_CONTENT);

      const result = await strategy.apply(
        srcFile,
        destFile,
        TEST_FILE,
        createContext()
      );

      // Test your strategy's unique behavior
      const content = await fs.readJson(destFile);
      expect(content).toMatchYourExpectations();
    });
  });

  // ===== Edge Cases =====
  describe("edge cases", () => {
    it("handles empty files gracefully", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, {});
      await fs.writeJson(destFile, {});

      const result = await strategy.apply(
        srcFile,
        destFile,
        TEST_FILE,
        createContext()
      );

      expect(result.action).toBe("skipped");
    });

    it("handles null and undefined values", async () => {
      const srcFile = path.join(srcDir, TEST_FILE);
      const destFile = path.join(destDir, TEST_FILE);
      await fs.writeJson(srcFile, { value: null });
      await fs.writeJson(destFile, { value: "something" });

      await strategy.apply(srcFile, destFile, TEST_FILE, createContext());

      const content = await fs.readJson(destFile);
      expect(content.value).toBeNull();
    });
  });
});
```

## For Complex Strategies (like tagged-merge)

If your strategy has multiple behaviors or modes, organize tests with nested describe blocks:

```typescript
describe("YourComplexStrategy", () => {
  // ... setup code ...

  describe("core behavior", () => {
    // Basic tests (has name, copies, skips, dry-run)
  });

  describe("behavior-mode-1", () => {
    // Tests for first behavior mode
    it("applies behavior-mode-1 logic", () => { /* ... */ });
    it("preserves project content in behavior-mode-1", () => { /* ... */ });
  });

  describe("behavior-mode-2", () => {
    // Tests for second behavior mode
    it("applies behavior-mode-2 logic", () => { /* ... */ });
  });

  describe("mixed behaviors", () => {
    // Tests when multiple behaviors are in same file
    it("handles mixed behaviors correctly", () => { /* ... */ });
  });

  describe("edge cases", () => {
    // Edge case tests
  });

  describe("file operations", () => {
    // Backup, recording, permissions, etc.
  });
});
```

## Minimal Test Count Guidelines

Based on existing strategies:

| Test Category | Minimum Tests |
|---------------|--------------|
| Core behavior | 4-6 tests |
| File operations | 3-4 tests |
| Strategy-specific | 3-5 tests |
| Edge cases | 3-5 tests |
| **Total** | **13-20 tests** |

For complex strategies (multiple behaviors): 25+ tests with nested describes.

## Common Assertions

```typescript
// Action types
expect(result.action).toBe("copied");
expect(result.action).toBe("skipped");
expect(result.action).toBe("merged");
expect(result.action).toBe("overwritten");
expect(result.action).toBe("created");

// File existence
expect(await fs.pathExists(destFile)).toBe(true);
expect(await fs.pathExists(destFile)).toBe(false);

// Content verification
expect(await fs.readFile(destFile, "utf-8")).toBe(expectedContent);
expect(await fs.readJson(destFile)).toEqual(expectedJson);

// Mock verification
expect(backupCalled).toBe(true);
expect(recorded).toEqual({ path: TEST_FILE, strategy: "your-strategy" });

// Error handling
await expect(
  strategy.apply(srcFile, destFile, TEST_FILE, createContext())
).rejects.toThrow();
```

## Key Testing Principles

1. **One assertion per behavior**: Each test verifies one thing
2. **Descriptive names**: Test name should explain what behavior is being tested
3. **Isolated setup**: Each test sets up its own data
4. **Mock context functions**: Track calls to recordFile, backupFile, promptOverwrite
5. **Verify file state**: Check both result.action AND actual file content
6. **Test dry-run**: Always verify dryRun doesn't modify but reports action
7. **Clean data constants**: Define test data at top for reuse

## Running Tests

```bash
# Run all strategy tests
npm test tests/unit/strategies/

# Run specific strategy test
npm test tests/unit/strategies/your-strategy.test.ts

# Run with coverage
npm run test:cov -- tests/unit/strategies/

# Watch mode
npm run test:watch tests/unit/strategies/
```

## Integration Test Patterns

For testing your strategy in context of full Lisa operations:

```typescript
// Location: tests/integration/strategies/your-strategy.integration.test.ts
describe("YourStrategy integration", () => {
  it("applies strategy within full Lisa workflow", async () => {
    // Create project, run Lisa, verify strategy was applied
  });

  it("records file in manifest with correct strategy", async () => {
    // Apply strategy, check manifest file
  });

  it("respects manifest during updates", async () => {
    // Run Lisa twice, verify idempotency
  });
});
```
