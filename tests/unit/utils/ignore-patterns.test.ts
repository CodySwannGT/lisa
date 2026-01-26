import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISAIGNORE_FILENAME,
  loadIgnorePatterns,
} from "../../../src/utils/ignore-patterns.js";

const ESLINT_CONFIG_FILE = "eslint.config.mjs";
const PRETTIERRC_FILE = ".prettierrc.json";

describe("ignore-patterns", () => {
  const testDir = path.join(process.cwd(), "tests", "fixtures", "ignore-test");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("loadIgnorePatterns", () => {
    it("returns empty patterns when .lisaignore does not exist", async () => {
      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.patterns).toEqual([]);
      expect(patterns.shouldIgnore("any/file.ts")).toBe(false);
    });

    it("loads patterns from .lisaignore file", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        `${ESLINT_CONFIG_FILE}\n${PRETTIERRC_FILE}`
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.patterns).toEqual([ESLINT_CONFIG_FILE, PRETTIERRC_FILE]);
    });

    it("ignores comments and empty lines", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        `# This is a comment\n${ESLINT_CONFIG_FILE}\n\n# Another comment\n${PRETTIERRC_FILE}\n`
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.patterns).toEqual([ESLINT_CONFIG_FILE, PRETTIERRC_FILE]);
    });
  });

  describe("shouldIgnore", () => {
    it("matches exact file names", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        ESLINT_CONFIG_FILE
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(ESLINT_CONFIG_FILE)).toBe(true);
      expect(patterns.shouldIgnore("other.config.mjs")).toBe(false);
    });

    it("matches files in subdirectories with exact name patterns", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        PRETTIERRC_FILE
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(PRETTIERRC_FILE)).toBe(true);
      // Pattern without slash matches anywhere
      expect(patterns.shouldIgnore(`subdir/${PRETTIERRC_FILE}`)).toBe(true);
    });

    it("matches directory patterns (ending with /)", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        ".claude/hooks/"
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(".claude/hooks/format.sh")).toBe(true);
      expect(patterns.shouldIgnore(".claude/hooks/lint.sh")).toBe(true);
      expect(patterns.shouldIgnore(".claude/rules/PROJECT_RULES.md")).toBe(
        false
      );
    });

    it("matches glob patterns with wildcards", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        "*.example.json"
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore("config.example.json")).toBe(true);
      expect(patterns.shouldIgnore("settings.example.json")).toBe(true);
      expect(patterns.shouldIgnore("config.json")).toBe(false);
    });

    it("matches ** glob patterns", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        "**/*.test.ts"
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore("file.test.ts")).toBe(true);
      expect(patterns.shouldIgnore("src/file.test.ts")).toBe(true);
      expect(patterns.shouldIgnore("src/deep/file.test.ts")).toBe(true);
      expect(patterns.shouldIgnore("file.ts")).toBe(false);
    });

    it("matches multiple patterns", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        `${ESLINT_CONFIG_FILE}\n${PRETTIERRC_FILE}\n.claude/hooks/`
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(ESLINT_CONFIG_FILE)).toBe(true);
      expect(patterns.shouldIgnore(PRETTIERRC_FILE)).toBe(true);
      expect(patterns.shouldIgnore(".claude/hooks/format.sh")).toBe(true);
      expect(patterns.shouldIgnore("package.json")).toBe(false);
    });

    it("handles Windows-style path separators", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        ".claude/hooks/"
      );

      const patterns = await loadIgnorePatterns(testDir);

      // Should normalize backslashes to forward slashes
      expect(patterns.shouldIgnore(".claude\\hooks\\format.sh")).toBe(true);
    });
  });
});
