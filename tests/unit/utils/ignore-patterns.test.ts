import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  LISAIGNORE_FILENAME,
  loadIgnorePatterns,
} from "../../../src/utils/ignore-patterns.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ESLINT_CONFIG_FILE = "eslint.config.mjs";
const PRETTIERRC_FILE = ".prettierrc.json";
const HOOKS_DIR_PATTERN = ".claude/hooks/";
const HOOKS_FORMAT_FILE = ".claude/hooks/format.sh";
const HOOKS_KEEP_FILE = ".claude/hooks/keep.sh";
const SCRIPTS_KEEP_FILE = "scripts/keep.mjs";

describe("ignore-patterns", () => {
  // CodySwannGT/lisa#3010. This was `path.join(process.cwd(), "tests",
  // "fixtures", "ignore-test")` — one fixed path under the worktree, shared by
  // every process running this suite. `beforeEach` created it and `afterEach`
  // removed it, so two concurrent runs deleted each other's `.lisaignore`
  // mid-test and `loadIgnorePatterns` read the file-absent case instead.
  // Measured on the pre-fix file: three simultaneous runs -> exit 1 in all
  // three, while the same suite run alone -> exit 0, 19 passed. No budget was
  // exceeded in either case, which is why this reads as machine load.
  //
  // `process.cwd()` also puts the path outside the run-scoped scratch root that
  // `src/configs/vitest/scratch-setup.ts` redirects `os.tmpdir()` into, so
  // #2886's isolation never reached it. `createTempDir` is `mkdtemp` under
  // `os.tmpdir()`, which the redirection does cover, and mkdtemp's suffix makes
  // the path unique per run and per test.
  let testDir: string;

  /** Every fixture path handed out, so uniqueness is asserted, not assumed. */
  const handedOut: string[] = [];

  beforeEach(async () => {
    testDir = await createTempDir();
    handedOut.push(testDir);
  });

  afterEach(async () => {
    await cleanupTempDir(testDir);
  });

  describe("fixture isolation", () => {
    it("puts the fixture outside the working directory", () => {
      // A fixture under cwd is shared by every concurrent run in the worktree.
      expect(testDir.startsWith(process.cwd())).toBe(false);
    });

    it("hands out a distinct directory to every test", () => {
      // A fixed path repeats here; mkdtemp cannot.
      expect(new Set(handedOut).size).toBe(handedOut.length);
    });
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

// The shipped starter template is where a project learns this syntax. It
// advertised "gitignore-style" and listed the forms while omitting `!`, so a
// reader who knew gitignore would reasonably write a negation line — and before
// the fix above, that one line reported the whole project as ignored. A fleet
// sweep found 0 negation lines across 6 repositories, so nobody had taken the
// invitation yet; this keeps the documented syntax and the implemented syntax
// from drifting apart again.
describe("the shipped .lisaignore template", () => {
  const template = readFileSync(
    path.join(process.cwd(), "all", "create-only", ".lisaignore"),
    "utf8"
  );

  it("documents negation and the last-match-wins rule", () => {
    expect(template).toContain("Negation:");
    expect(template).toContain("LAST one to match");
  });

  it("says what ignoring costs, not just what it does", () => {
    // Ignoring is the one action here that permanently opts a file out of
    // upstream fixes. A template that lists it as a bare syntax form invites
    // someone to reach for it to quiet a warning.
    expect(template).toContain("stops receiving upstream fixes");
  });

  it("steers a Lisa-owned guard to lisa-guard-capabilities instead", () => {
    expect(template).toContain("lisa-guard-capabilities");
  });
});
