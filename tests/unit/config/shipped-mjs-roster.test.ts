/**
 * The scope of the shipped-`.mjs` gates: what a push carries, not what is on
 * disk.
 *
 * CodySwannGT/lisa#2824. Both shipped-`.mjs` suites discovered their subject by
 * walking `<stack>/copy-overwrite/` trees on the filesystem. An agent created an
 * untracked `.mjs` under one of those trees; a different agent sharing the
 * checkout was blocked from pushing by lint findings in it — a file absent from
 * their `git status`, absent from their diff, and unattributable from their
 * side. The gate is required, so there was no proceeding.
 *
 * These tests pin the replacement property against a real throwaway git
 * repository rather than against this checkout, so they assert the rule itself
 * instead of whatever this working tree happens to contain today.
 * @module tests/unit/config/shipped-mjs-roster
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  isShippedMjs,
  shippedMjsOnDisk,
  shippedMjsRoster,
  untrackedFindingNote,
} from "../../helpers/shipped-mjs-roster.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();
const TRACKED = "all/copy-overwrite/scripts/tracked.mjs";
const UNTRACKED = "all/copy-overwrite/scripts/lib/scratch.mjs";

/**
 * Every step here shells out to git, and a wall-clock budget over a subprocess
 * measures the MACHINE rather than the work (CodySwannGT/lisa#2822). Building
 * this fixture costs ~0.01s of CPU and was measured at 38s of wall clock on a
 * saturated host, so the budget is set far above the work rather than near it.
 *
 * Calibrated through {@link ioLatencyBudgetMs} rather than written bare: a
 * per-case budget silently overrides the file-level one, so a fixed number here
 * would pin this suite to one machine's speed while every sibling scaled. That
 * is the defect `io-latency-budget` refuses, and it refused this — the constant
 * spelling is the form that hides from a `}, N)` grep, not an exemption from
 * the rule.
 */
const GIT_BUDGET_MS = ioLatencyBudgetMs(300_000);

let fixture = "";

/**
 * Run a git command in the fixture repository and fail loudly if it errors.
 * @param args - Arguments passed to git
 */
function git(args: readonly string[]): void {
  const child = boundedSpawnSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd: fixture,
    // Without this the outer checkout's GIT_* variables point every one of
    // these commands back at the repository the suite is running inside.
    env: cleanGitEnv(),
  });
  if (child.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${child.stderr ?? ""}`);
  }
}

/**
 * Create a file in the fixture repository, parents included.
 * @param relativePath - Repo-relative path
 * @param body - File contents
 */
function write(relativePath: string, body: string): void {
  const full = path.join(fixture, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-shipped-mjs-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "commit.gpgsign", "false"]);

  write(TRACKED, "export default 1;\n");
  // A shipped-looking file outside any copy-overwrite tree, and one under a
  // dot-prefixed top-level directory: both are outside the payload and neither
  // may join the roster by either route.
  write("all/other/not-shipped.mjs", "export default 2;\n");
  write(".hidden/copy-overwrite/hidden.mjs", "export default 3;\n");
  git(["add", "-A"]);
  git(["commit", "-m", "fixture"]);

  // Created after the commit, never staged — the #2824 file.
  write(UNTRACKED, "export default 4;\n");
}, GIT_BUDGET_MS);

afterAll(() => {
  if (fixture !== "") fs.rmSync(fixture, { recursive: true, force: true });
});

describe("shipped .mjs roster: membership", { timeout: GIT_BUDGET_MS }, () => {
  it("counts a .mjs inside a copy-overwrite tree", () => {
    expect(isShippedMjs(TRACKED)).toBe(true);
  });

  it("excludes a .mjs outside any copy-overwrite tree", () => {
    expect(isShippedMjs("all/other/not-shipped.mjs")).toBe(false);
  });

  it("excludes a copy-overwrite tree under a dot-prefixed directory", () => {
    // Matches what the filesystem walk selected, so scoping to the index does
    // not quietly widen the payload while it is narrowing it.
    expect(isShippedMjs(".hidden/copy-overwrite/hidden.mjs")).toBe(false);
  });

  it("excludes a non-.mjs file inside a copy-overwrite tree", () => {
    expect(isShippedMjs("all/copy-overwrite/scripts/lisa-gates.sh")).toBe(
      false
    );
  });

  it("excludes a copy-overwrite directory that is not the second segment", () => {
    expect(isShippedMjs("all/nested/copy-overwrite/deep.mjs")).toBe(false);
  });
});

describe(
  "shipped .mjs roster: an untracked file cannot block a push",
  { timeout: GIT_BUDGET_MS },
  () => {
    it("sees the untracked file on disk", () => {
      // The premise. If the walk stopped finding it, the split below would pass
      // for the wrong reason and this suite would prove nothing.
      expect(shippedMjsOnDisk(fixture)).toContain(UNTRACKED);
    });

    it("keeps the untracked file out of the enforced set", () => {
      expect(shippedMjsRoster(fixture).tracked).toEqual([TRACKED]);
    });

    it("still reports the untracked file rather than ignoring it", () => {
      // Narrowing what a gate BLOCKS on is not licence to narrow what it looks
      // at. A gate that stops examining things stops catching things.
      expect(shippedMjsRoster(fixture).untracked).toEqual([UNTRACKED]);
    });

    it("moves the file into the enforced set the moment it is staged", () => {
      git(["add", UNTRACKED]);
      try {
        // Sorted by path, so the nested `lib/` entry precedes `tracked.mjs`.
        expect(shippedMjsRoster(fixture).tracked).toEqual([UNTRACKED, TRACKED]);
        expect(shippedMjsRoster(fixture).untracked).toEqual([]);
      } finally {
        git(["rm", "--cached", "-q", UNTRACKED]);
      }
    });

    it("drops a tracked path whose file is gone from disk", () => {
      // `git ls-files` still lists a file deleted from the working tree. Handing
      // ESLint a path with nothing behind it fails the harness, not the payload.
      fs.rmSync(path.join(fixture, TRACKED));
      try {
        expect(shippedMjsRoster(fixture).tracked).toEqual([]);
      } finally {
        write(TRACKED, "export default 1;\n");
      }
    });
  }
);

describe("shipped .mjs roster: what the untracked note says", () => {
  const note = untrackedFindingNote("/repo", [
    "all/copy-overwrite/scripts/lib/scratch.mjs:1:11 sonarjs/x — bad",
  ]);

  it("says the findings are not blocking", () => {
    expect(note).toContain("NOT BLOCKING");
  });

  it("says the file is untracked", () => {
    expect(note).toContain("UNTRACKED");
  });

  it("prints an absolute path, because the reader may be elsewhere", () => {
    // The repo-relative spelling is exactly what the blocked agent in #2824
    // could not resolve: it named a path that did not exist in their tree.
    expect(note).toContain(
      "/repo/all/copy-overwrite/scripts/lib/scratch.mjs:1:11"
    );
  });

  it("tells an author who meant to ship it what to do", () => {
    expect(note).toContain("git add");
  });

  it("says nothing at all when there is nothing to report", () => {
    expect(untrackedFindingNote("/repo", [])).toBe("");
  });
});
