import { minimatch } from "minimatch";
import { afterEach, describe, expect, it } from "vitest";
import { worktreeTestPathIgnorePatterns } from "../../../src/configs/jest/base.js";
import { worktreeExclusions } from "../../../src/configs/vitest/base.js";
import {
  WORKTREE_CWD_PATTERN,
  WORKTREE_ROOTS,
} from "../../../src/configs/worktrees.js";

/**
 * Paths that must NEVER be excluded as worktrees.
 *
 * These are the over-match direction of the anchoring invariant, and they are
 * not hypothetical. Downstream in `acmeorga/frontend` an unanchored `/\.claude/`
 * in Metro's blockList matched every file in the project. Two of these entries
 * are real files in this repo whose own names contain the words a sloppy
 * pattern would key on.
 */
const NON_WORKTREE_PATHS: readonly string[] = [
  "src/configs/worktrees.ts",
  "tests/unit/config/worktree-exclusion-anchoring.test.ts",
  ".claude/settings.json",
  ".claude/skills/lisa-doctor/SKILL.md",
  ".claude/rules/PROJECT_RULES.md",
  "src/cli/doctor-worktree-hygiene.ts",
  "worktrees/not-the-root.ts",
];

/** Paths that must always be excluded as worktrees. */
const WORKTREE_PATHS: readonly string[] = [
  ".claude/worktrees/agent-abc/src/index.ts",
  ".claude/worktrees/agent-abc/tests/unit/thing.test.ts",
  ".worktrees/tun-401/src/index.ts",
];

const realCwd = process.cwd;

afterEach(() => {
  process.cwd = realCwd;
});

/**
 * Pretend the process is running from the primary checkout.
 *
 * Both exclusion helpers are cwd-conditional — they return an empty list when
 * already inside a worktree — so anchoring can only be asserted from outside.
 */
function fromPrimaryCheckout(): void {
  process.cwd = () => "/some/project";
}

describe("worktree exclusion anchoring", () => {
  it("names a full worktree root in every vitest glob", () => {
    fromPrimaryCheckout();

    for (const glob of worktreeExclusions()) {
      expect(
        WORKTREE_ROOTS.some(root => glob.includes(root)),
        `vitest glob ${glob} does not name a full worktree root`
      ).toBe(true);
    }
  });

  it("names a full worktree root in every jest ignore pattern", () => {
    fromPrimaryCheckout();

    for (const pattern of worktreeTestPathIgnorePatterns()) {
      expect(
        WORKTREE_ROOTS.some(root => pattern.includes(root)),
        `jest pattern ${pattern} does not name a full worktree root`
      ).toBe(true);
    }
  });

  it("excludes real worktree paths from vitest", () => {
    fromPrimaryCheckout();
    const globs = worktreeExclusions();

    for (const workPath of WORKTREE_PATHS) {
      expect(
        globs.some(glob => minimatch(workPath, glob)),
        `${workPath} should have been excluded`
      ).toBe(true);
    }
  });

  it("leaves .claude and worktree-named project files alone in vitest", () => {
    fromPrimaryCheckout();
    const globs = worktreeExclusions();

    for (const safePath of NON_WORKTREE_PATHS) {
      expect(
        globs.some(glob => minimatch(safePath, glob)),
        `${safePath} must not be excluded as a worktree`
      ).toBe(false);
    }
  });

  it("excludes real worktree paths from jest", () => {
    fromPrimaryCheckout();
    const patterns = worktreeTestPathIgnorePatterns();

    for (const workPath of WORKTREE_PATHS) {
      expect(
        patterns.some(pattern => new RegExp(pattern).test(`/repo/${workPath}`)),
        `${workPath} should have been excluded`
      ).toBe(true);
    }
  });

  it("leaves .claude and worktree-named project files alone in jest", () => {
    fromPrimaryCheckout();
    const patterns = worktreeTestPathIgnorePatterns();

    for (const safePath of NON_WORKTREE_PATHS) {
      expect(
        patterns.some(pattern => new RegExp(pattern).test(`/repo/${safePath}`)),
        `${safePath} must not be excluded as a worktree`
      ).toBe(false);
    }
  });

  it("does not treat an ordinary .claude directory as a worktree cwd", () => {
    expect(WORKTREE_CWD_PATTERN.test("/Users/dev/project/.claude")).toBe(false);
    expect(
      WORKTREE_CWD_PATTERN.test("/Users/dev/project/.claude/skills/lisa-doctor")
    ).toBe(false);
    expect(WORKTREE_CWD_PATTERN.test("/Users/dev/.claude/plugins/lisa")).toBe(
      false
    );
  });

  it("does not treat a directory merely named worktrees as a worktree cwd", () => {
    expect(WORKTREE_CWD_PATTERN.test("/Users/dev/project/worktrees")).toBe(
      false
    );
    expect(WORKTREE_CWD_PATTERN.test("/Users/dev/project/src/worktrees")).toBe(
      false
    );
  });
});
