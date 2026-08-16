import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  LISAIGNORE_FILENAME,
  loadIgnorePatterns,
} from "../../../src/utils/ignore-patterns.js";

const ESLINT_CONFIG_FILE = "eslint.config.mjs";
const PRETTIERRC_FILE = ".prettierrc.json";
const HOOKS_DIR_PATTERN = ".claude/hooks/";
const HOOKS_FORMAT_FILE = ".claude/hooks/format.sh";
const HOOKS_KEEP_FILE = ".claude/hooks/keep.sh";
const SCRIPTS_KEEP_FILE = "scripts/keep.mjs";

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
        HOOKS_DIR_PATTERN
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(HOOKS_FORMAT_FILE)).toBe(true);
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
        `${ESLINT_CONFIG_FILE}\n${PRETTIERRC_FILE}\n${HOOKS_DIR_PATTERN}`
      );

      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns.shouldIgnore(ESLINT_CONFIG_FILE)).toBe(true);
      expect(patterns.shouldIgnore(PRETTIERRC_FILE)).toBe(true);
      expect(patterns.shouldIgnore(HOOKS_FORMAT_FILE)).toBe(true);
      expect(patterns.shouldIgnore("package.json")).toBe(false);
    });

    it("handles Windows-style path separators", async () => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        HOOKS_DIR_PATTERN
      );

      const patterns = await loadIgnorePatterns(testDir);

      // Should normalize backslashes to forward slashes
      expect(patterns.shouldIgnore(".claude\\hooks\\format.sh")).toBe(true);
    });
  });

  // The file documents itself as gitignore-style, and gitignore's `!` re-includes
  // a path an earlier pattern ignored. It was passed straight to minimatch, which
  // negates by DEFAULT — so `!x` matched everything that was not `x`, and the
  // combining `.some()` turned one such line into "ignore the whole project".
  // Measured before the fix:
  //
  //   ["!scripts/a.mjs"]                    scripts/a.mjs -> false
  //   ["!scripts/a.mjs"]                    scripts/b.mjs -> TRUE
  //   ["!scripts/a.mjs"]                    tsconfig.json -> TRUE   <- everything
  //   ["scripts/*.mjs","!scripts/a.mjs"]    scripts/a.mjs -> TRUE   <- inverted
  //
  // An ignored path is not a candidate for apply, so a project that wrote one
  // `!` line stopped being managed by Lisa at all, silently and with no error.
  describe("negation (`!`)", () => {
    const ignoreWith = async (
      lines: readonly string[]
    ): Promise<(p: string) => boolean> => {
      await fs.writeFile(
        path.join(testDir, LISAIGNORE_FILENAME),
        lines.join("\n")
      );
      const loaded = await loadIgnorePatterns(testDir);
      return loaded.shouldIgnore;
    };

    it("re-includes a path an earlier pattern ignored", async () => {
      const shouldIgnore = await ignoreWith([
        "scripts/*.mjs",
        "!scripts/a.mjs",
      ]);

      expect(shouldIgnore("scripts/a.mjs")).toBe(false);
      expect(shouldIgnore("scripts/b.mjs")).toBe(true);
    });

    it("never ignores a path no pattern selected", async () => {
      // The severe case: a lone negation must not sweep in the whole project.
      const shouldIgnore = await ignoreWith(["!scripts/a.mjs"]);

      expect(shouldIgnore("tsconfig.json")).toBe(false);
      expect(shouldIgnore("scripts/b.mjs")).toBe(false);
      expect(shouldIgnore("scripts/a.mjs")).toBe(false);
    });

    it("applies last-match-wins, not first-match-wins", async () => {
      const reIncluded = await ignoreWith([
        "scripts/",
        `!${SCRIPTS_KEEP_FILE}`,
      ]);
      expect(reIncluded(SCRIPTS_KEEP_FILE)).toBe(false);

      const reIgnored = await ignoreWith([
        "scripts/",
        `!${SCRIPTS_KEEP_FILE}`,
        SCRIPTS_KEEP_FILE,
      ]);
      expect(reIgnored(SCRIPTS_KEEP_FILE)).toBe(true);
    });

    it("negates directory and bare-segment patterns too", async () => {
      const dir = await ignoreWith([HOOKS_DIR_PATTERN, `!${HOOKS_KEEP_FILE}`]);
      expect(dir(HOOKS_FORMAT_FILE)).toBe(true);
      expect(dir(HOOKS_KEEP_FILE)).toBe(false);

      const segment = await ignoreWith(["*.mjs", "!keep.mjs"]);
      expect(segment("scripts/other.mjs")).toBe(true);
      expect(segment(SCRIPTS_KEEP_FILE)).toBe(false);
    });

    it("treats a backslash-escaped bang as a literal leading `!`", async () => {
      const shouldIgnore = await ignoreWith(["\\!weird.json"]);

      expect(shouldIgnore("!weird.json")).toBe(true);
      expect(shouldIgnore("weird.json")).toBe(false);
    });

    it("keeps the bare `!` line inert rather than matching everything", async () => {
      const shouldIgnore = await ignoreWith(["!"]);

      expect(shouldIgnore("tsconfig.json")).toBe(false);
    });
  });
});
