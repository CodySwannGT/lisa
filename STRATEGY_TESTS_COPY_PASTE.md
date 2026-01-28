# Strategy Tests - Copy/Paste Code Snippets

Quick copy-paste snippets for writing strategy tests. These are extracted directly from existing tests.

## Setup Boilerplate

### Imports
```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { YourStrategyName } from "../../../src/strategies/your-strategy.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
```

### Describe Block Setup
```typescript
describe("YourStrategyName", () => {
  let strategy: YourStrategyName;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new YourStrategyName();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });
```

### Context Creation Helper
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

## Core Behavior Tests

### Test: Has Correct Name
```typescript
  it("has correct name", () => {
    expect(strategy.name).toBe("your-strategy");
  });
```

### Test: Copies When Destination Missing
```typescript
  it("copies file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { name: "test" });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
    const content = await fs.readJson(destFile);
    expect(content.name).toBe("test");
  });
```

### Test: Skips When Files Identical
```typescript
  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    const content = { same: "content" };
    await fs.writeJson(srcFile, content);
    await fs.writeJson(destFile, content);

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });
```

### Test: Respects Dry-Run Mode
```typescript
  it("respects dry-run mode", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

    const originalContent = await fs.readJson(destFile);

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext({ dryRun: true })
    );

    const finalContent = await fs.readJson(destFile);
    expect(finalContent).toEqual(originalContent);
    expect(result.action).toBeTruthy(); // Action reported but file unchanged
  });
```

## File Operation Tests

### Test: Backs Up Before Merging
```typescript
  it("backs up file before merging", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { new: "value" });
    await fs.writeJson(destFile, { existing: "value" });

    let backupCalled = false;
    const context = {
      ...createContext(),
      backupFile: async () => {
        backupCalled = true;
      },
    };

    await strategy.apply(srcFile, destFile, "package.json", context);

    expect(backupCalled).toBe(true);
  });
```

### Test: Calls recordFile with Correct Arguments
```typescript
  it("records file in manifest correctly", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, { test: "value" });
    await fs.writeJson(destFile, { existing: "value" });

    let recordedPath = "";
    let recordedStrategy = "";
    const context = {
      ...createContext(),
      recordFile: (path: string, strategy: string) => {
        recordedPath = path;
        recordedStrategy = strategy;
      },
    };

    await strategy.apply(srcFile, destFile, "package.json", context);

    expect(recordedPath).toBe("package.json");
    expect(recordedStrategy).toBe("your-strategy");
  });
```

### Test: Creates Parent Directories
```typescript
  it("creates parent directories when needed", async () => {
    const srcFile = path.join(srcDir, "file.json");
    const destFile = path.join(destDir, "nested", "deep", "file.json");
    await fs.writeJson(srcFile, { content: "value" });

    await strategy.apply(
      srcFile,
      destFile,
      "nested/deep/file.json",
      createContext()
    );

    expect(await fs.pathExists(destFile)).toBe(true);
  });
```

## Edge Case Tests

### Test: Handles Empty Objects
```typescript
  it("handles empty JSON objects", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");
    await fs.writeJson(srcFile, {});
    await fs.writeJson(destFile, {});

    const result = await strategy.apply(
      srcFile,
      destFile,
      "package.json",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });
```

### Test: Handles Null Values
```typescript
  it("handles null values gracefully", async () => {
    const srcFile = path.join(srcDir, "config.json");
    const destFile = path.join(destDir, "config.json");
    await fs.writeJson(srcFile, { value: null });
    await fs.writeJson(destFile, { value: "something" });

    await strategy.apply(srcFile, destFile, "config.json", createContext());

    const content = await fs.readJson(destFile);
    expect(content.value).toBeNull();
  });
```

### Test: Handles Invalid JSON
```typescript
  it("throws error for invalid source JSON", async () => {
    const srcFile = path.join(srcDir, "invalid.json");
    const destFile = path.join(destDir, "invalid.json");
    await fs.writeFile(srcFile, "not valid json");
    await fs.writeJson(destFile, { valid: true });

    await expect(
      strategy.apply(srcFile, destFile, "invalid.json", createContext())
    ).rejects.toThrow();
  });
```

## Text File Tests (like .gitignore)

### Test: Replaces Block with Markers
```typescript
  it("replaces block when markers exist", async () => {
    const srcFile = path.join(srcDir, ".gitignore");
    const destFile = path.join(destDir, ".gitignore");
    const BEGIN = "# BEGIN: MANAGED";
    const END = "# END: MANAGED";

    const srcContent = `${BEGIN}\ndist\n${END}`;
    const destContent = `# Custom\nmy-dir\n${BEGIN}\nold\n${END}\n`;

    await fs.writeFile(srcFile, srcContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      ".gitignore",
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain("# Custom");
    expect(content).toContain("dist");
    expect(content).not.toContain("old");
  });
```

### Test: Appends When No Markers
```typescript
  it("appends when markers do not exist", async () => {
    const srcFile = path.join(srcDir, ".gitignore");
    const destFile = path.join(destDir, ".gitignore");
    const BEGIN = "# BEGIN: MANAGED";
    const END = "# END: MANAGED";

    const srcContent = `${BEGIN}\nnode_modules\n${END}`;
    const destContent = "# Custom entries\nmy-dir\n";

    await fs.writeFile(srcFile, srcContent);
    await fs.writeFile(destFile, destContent);

    const result = await strategy.apply(
      srcFile,
      destFile,
      ".gitignore",
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readFile(destFile, "utf-8");
    expect(content).toContain("# Custom entries");
    expect(content).toContain(srcContent);
  });
```

## JSON Merge Tests

### Test: Deep Merges with Lisa Priority
```typescript
  it("deep merges objects with Lisa values taking precedence", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");

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
      "package.json",
      createContext()
    );

    expect(result.action).toBe("merged");

    const content = await fs.readJson(destFile);
    expect(content.name).toBe("my-project");
    expect(content.scripts.test).toBe("vitest");
    expect(content.scripts.build).toBe("tsc");
    expect(content.devDependencies.vitest).toBe("^1.0.0");
  });
```

### Test: Handles Nested Objects
```typescript
  it("handles nested objects", async () => {
    const srcFile = path.join(srcDir, "settings.json");
    const destFile = path.join(destDir, "settings.json");

    await fs.writeJson(srcFile, {
      editor: {
        tabSize: 2,
        formatOnSave: true,
      },
    });

    await fs.writeJson(destFile, {
      editor: {
        tabSize: 4,
      },
    });

    await strategy.apply(srcFile, destFile, "settings.json", createContext());

    const content = await fs.readJson(destFile);
    expect(content.editor.tabSize).toBe(2); // Lisa value wins
    expect(content.editor.formatOnSave).toBe(true); // Lisa value added
  });
```

## Tagged Section Tests (for tagged-merge)

### Test: Replaces Force Section
```typescript
  it("replaces force section with Lisa version", async () => {
    const srcFile = path.join(srcDir, "package.json");
    const destFile = path.join(destDir, "package.json");

    await fs.writeJson(srcFile, {
      "//lisa-force-scripts": "Required scripts",
      scripts: {
        test: "vitest",
        build: "tsc",
      },
      "//end-lisa-force-scripts": "",
    });

    await fs.writeJson(destFile, {
      "//lisa-force-scripts": "Required scripts",
      scripts: {
        test: "jest",
        build: "rollup",
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

### Test: Merges Arrays Without Duplicates
```typescript
  it("deduplicates array items", async () => {
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

## Context Override Examples

### Override: dryRun
```typescript
const result = await strategy.apply(
  srcFile,
  destFile,
  "package.json",
  createContext({ dryRun: true })
);
```

### Override: Multiple Config Values
```typescript
const result = await strategy.apply(
  srcFile,
  destFile,
  "package.json",
  createContext({
    dryRun: false,
    yesMode: false,
    validateOnly: true,
  })
);
```

### Override: promptOverwrite Returns False
```typescript
const context = {
  ...createContext(),
  promptOverwrite: async () => false,
};

const result = await strategy.apply(srcFile, destFile, "file.json", context);
expect(result.action).toBe("skipped");
```

## Assertion Patterns

### Assert Result Action
```typescript
expect(result.action).toBe("copied");
expect(result.action).toBe("skipped");
expect(result.action).toBe("merged");
expect(result.action).toBe("overwritten");
expect(result.action).toBe("created");
```

### Assert File Existence
```typescript
expect(await fs.pathExists(destFile)).toBe(true);
expect(await fs.pathExists(destFile)).toBe(false);
```

### Assert File Content (JSON)
```typescript
const content = await fs.readJson(destFile);
expect(content).toEqual(expected);
expect(content.field).toBe("value");
```

### Assert File Content (Text)
```typescript
const content = await fs.readFile(destFile, "utf-8");
expect(content).toBe("exact content");
expect(content).toContain("partial content");
```

### Assert Mock Was Called
```typescript
expect(backupCalled).toBe(true);
expect(recordedPath).toBe("file.json");
```

### Assert Errors
```typescript
await expect(
  strategy.apply(srcFile, destFile, "invalid.json", createContext())
).rejects.toThrow();
```

## Complete Minimal Test

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { YourStrategy } from "../../../src/strategies/your-strategy.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("YourStrategy", () => {
  let strategy: YourStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new YourStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

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

  it("has correct name", () => {
    expect(strategy.name).toBe("your-strategy");
  });

  it("copies file when destination does not exist", async () => {
    const srcFile = path.join(srcDir, "test.json");
    const destFile = path.join(destDir, "test.json");
    await fs.writeJson(srcFile, { name: "test" });

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.json",
      createContext()
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(destFile)).toBe(true);
  });

  it("skips when files are identical", async () => {
    const srcFile = path.join(srcDir, "test.json");
    const destFile = path.join(destDir, "test.json");
    const content = { same: "value" };
    await fs.writeJson(srcFile, content);
    await fs.writeJson(destFile, content);

    const result = await strategy.apply(
      srcFile,
      destFile,
      "test.json",
      createContext()
    );

    expect(result.action).toBe("skipped");
  });
});
```

This minimal test gives you a working starting point with 3 basic tests that cover essential behavior.
