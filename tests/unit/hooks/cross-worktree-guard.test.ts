/**
 * Tests for the cross-worktree staged-blob guard.
 *
 * The guard refuses a commit that stages a NEW file byte-identical to
 * uncommitted content living in a different linked worktree — the observed
 * failure where one agent's work in progress is committed by another, with a
 * rewritten subject line, and nothing about the result looks wrong.
 *
 * WHY EVERY ACCEPTING FIXTURE PUTS THE FILE UNTRACKED IN THE OTHER WORKTREE.
 * The guard has four independent reasons to accept, and they overlap. Fixtures
 * that left the file TRACKED over there were measured passing for the wrong
 * reason: the tracked-check accepted them before the clause under test was ever
 * consulted, so mutating that clause changed nothing and the test proved
 * nothing. Each accepting case below is therefore built so that exactly one
 * clause can be responsible — verified by mutation, one clause disabled at a
 * time, each case flipping to a refusal.
 * @module tests/unit/hooks/cross-worktree-guard
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

const GUARD_PATH = path.resolve(
  "all/copy-overwrite/scripts/lisa-cross-worktree-guard.mjs"
);
const GIT_PATH = resolveGit();

/** Content comfortably above the guard's 64-byte interest floor. */
const NOVEL = "novel authored content, well past the byte floor.\n".repeat(3);
const SHARED = "content the integration branch already carries.\n".repeat(3);
const TINY = "tiny\n";

const SHARED_FILE = "shared.txt";
const NOVEL_FILE = "novel.txt";
const TINY_FILE = "tiny.txt";
const QUIET = "-q";
const MAIN = "main";
/**
 * Two branches that do not carry `shared.txt`, so re-adding it registers as an
 * addition and the other worktree can hold it untracked. Named rather than
 * indexed out of an array: indexing widens to `string | undefined`, and the
 * fixture needs the branch names to be definitely present.
 */
const BARE_COMMITTER = "nosh1";
const BARE_OTHER = "nosh2";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * `cleanGitEnv` plus the guard's own override, which must not leak in from the
 * session running these tests — an inherited clearance would make every
 * refusing case pass and the suite would report green having proved nothing.
 * @returns Environment safe for fixture git commands.
 */
function guardEnv(): NodeJS.ProcessEnv {
  const env = cleanGitEnv();
  delete env.LISA_ALLOW_CROSS_WORKTREE_BLOB;
  return env;
}

/**
 * Run git in a fixture directory.
 * @param cwd Directory to run in.
 * @param args Git arguments.
 * @returns The completed spawn result.
 */
function git(cwd: string, args: readonly string[]) {
  return boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT_PATH,
    args: [...args],
    cwd,
    env: guardEnv(),
  });
}

/**
 * Run the guard in a worktree.
 * @param cwd Worktree to run in.
 * @param env Extra environment entries.
 * @returns The completed spawn result.
 */
function runGuard(cwd: string, env: NodeJS.ProcessEnv = {}) {
  return boundedSpawnSync({
    label: "cross-worktree-guard",
    command: process.execPath,
    args: [GUARD_PATH],
    cwd,
    env: { ...guardEnv(), ...env },
  });
}

/**
 * A repository with `main` (carrying `shared.txt`), two branches that do not
 * carry it, and a resolvable `origin/main`.
 * @returns Absolute paths of the fixture pieces.
 */
function buildFixture(): {
  readonly committer: string;
  readonly other: string;
  readonly onMain: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-xwt-"));
  const upstream = path.join(root, "upstream");
  const onMain = path.join(root, "onmain");
  const committer = path.join(root, "committer");
  const other = path.join(root, "other");
  const bare = [BARE_COMMITTER, BARE_OTHER];

  tempDirs.push(root);
  git(root, ["init", QUIET, "-b", MAIN, "upstream"]);
  git(upstream, ["config", "user.email", "f@example.invalid"]);
  git(upstream, ["config", "user.name", "Fixture"]);
  writeFileSync(path.join(upstream, SHARED_FILE), SHARED);
  writeFileSync(path.join(upstream, "baseline.txt"), "baseline\n");
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", QUIET, "-m", "baseline"]);
  for (const branch of bare) {
    git(upstream, ["checkout", QUIET, "-b", branch, MAIN]);
    git(upstream, ["rm", QUIET, SHARED_FILE]);
    git(upstream, ["commit", QUIET, "-m", `drop shared on ${branch}`]);
  }
  git(upstream, ["checkout", QUIET, MAIN]);
  git(upstream, ["worktree", "add", QUIET, onMain, "-b", "workmain", MAIN]);
  git(upstream, ["worktree", "add", QUIET, committer, BARE_COMMITTER]);
  git(upstream, ["worktree", "add", QUIET, other, BARE_OTHER]);
  git(upstream, [
    "update-ref",
    "refs/remotes/origin/main",
    git(upstream, ["rev-parse", MAIN]).stdout.trim(),
  ]);
  git(upstream, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);

  return { committer, other, onMain };
}

describe("cross-worktree staged-blob guard", () => {
  describe("the case it exists for", () => {
    it("refuses a staged addition byte-identical to another worktree's untracked file", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);
      writeFileSync(path.join(committer, NOVEL_FILE), NOVEL);
      git(committer, ["add", NOVEL_FILE]);

      expect(runGuard(committer).status).toBe(1);
    });

    it("names the path and the worktree the content also lives in", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);
      writeFileSync(path.join(committer, NOVEL_FILE), NOVEL);
      git(committer, ["add", NOVEL_FILE]);

      const stderr = runGuard(committer).stderr;
      expect(stderr).toContain(NOVEL_FILE);
      expect(stderr).toContain(other);
    });

    it("tells the reader not to enter or delete the other worktree", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);
      writeFileSync(path.join(committer, NOVEL_FILE), NOVEL);
      git(committer, ["add", NOVEL_FILE]);

      const stderr = runGuard(committer).stderr;
      // Entering it is what the isolation defect already does by accident, and
      // deleting it destroys the only copy of the work being protected.
      expect(stderr).toContain("do not delete it");
    });
  });

  describe("what it must not fire on", () => {
    it("accepts a MODIFIED file, even when another worktree holds it untracked", () => {
      // Regenerated artifacts are deterministic, so two worktrees legitimately
      // produce identical modified content. Only additions are suspicious.
      const { onMain, other } = buildFixture();
      writeFileSync(path.join(other, SHARED_FILE), NOVEL);
      writeFileSync(path.join(onMain, SHARED_FILE), NOVEL);
      git(onMain, ["add", SHARED_FILE]);

      expect(git(onMain, ["diff", "--cached", "--name-status"]).stdout).toMatch(
        /^M/
      );
      expect(runGuard(onMain).status).toBe(0);
    });

    it("accepts an addition whose content is the integration branch's own", () => {
      // The rejection control. Without it the guard fires on content every
      // worktree carries for the ordinary reason, which is noise everywhere.
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, SHARED_FILE), SHARED);
      writeFileSync(path.join(committer, SHARED_FILE), SHARED);
      git(committer, ["add", SHARED_FILE]);

      expect(runGuard(committer).status).toBe(0);
    });

    it("accepts an addition that is tracked in the other worktree", () => {
      // Tracked there means it arrived through a branch — shared history, not
      // that agent's work in progress.
      const { committer, onMain } = buildFixture();
      writeFileSync(path.join(committer, SHARED_FILE), SHARED);
      git(committer, ["add", SHARED_FILE]);

      expect(
        git(onMain, ["ls-files", "--error-unmatch", SHARED_FILE]).status
      ).toBe(0);
      expect(runGuard(committer).status).toBe(0);
    });

    it("accepts an identical addition below the byte floor", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, TINY_FILE), TINY);
      writeFileSync(path.join(committer, TINY_FILE), TINY);
      git(committer, ["add", TINY_FILE]);

      expect(runGuard(committer).status).toBe(0);
    });

    it("accepts when nothing is staged", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);

      expect(runGuard(committer).status).toBe(0);
    });
  });

  describe("co-generated artifacts", () => {
    // Two agents running the same deterministic generator against the same
    // source produce byte-identical output in different worktrees that is not
    // yet on the integration branch — this guard's trigger condition exactly,
    // and legitimate concurrent work rather than one agent taking another's.
    //
    // For an artifact that ALREADY EXISTS upstream the case is excluded twice
    // (it stages as a modification, and it is tracked over there), verified
    // against the real repository. A generator emitting a file that is NOT yet
    // upstream has neither protection, which is what these cases cover.
    const GENERATED = `/** Generated by scripts/make-it.mjs. Do not edit. */\n${NOVEL}`;
    const AUTHORED = `/** A module somebody wrote by hand. */\n${NOVEL}`;

    it("accepts a new artifact that declares itself generated", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), GENERATED);
      writeFileSync(path.join(committer, NOVEL_FILE), GENERATED);
      git(committer, ["add", NOVEL_FILE]);

      expect(runGuard(committer).status).toBe(0);
    });

    it("refuses the same bytes when nothing declares them generated", () => {
      // The discriminating half. Identical shape, identical size, identical
      // staging — only the header differs. Without this pair the case above
      // would pass for a guard that had simply stopped firing.
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), AUTHORED);
      writeFileSync(path.join(committer, NOVEL_FILE), AUTHORED);
      git(committer, ["add", NOVEL_FILE]);

      expect(runGuard(committer).status).toBe(1);
    });

    it("reads the declaration in the header only, not anywhere in the file", () => {
      // A rule, a skill, or a comment quoting a banner can contain the words
      // "do not edit" far down an authored file. Honouring those would let any
      // file silence the guard by mentioning it.
      const { committer, other } = buildFixture();
      const buried = `${AUTHORED}${"filler line, pushing the phrase past the header window.\n".repeat(60)}Do not edit\n`;
      writeFileSync(path.join(other, NOVEL_FILE), buried);
      writeFileSync(path.join(committer, NOVEL_FILE), buried);
      git(committer, ["add", NOVEL_FILE]);

      expect(runGuard(committer).status).toBe(1);
    });
  });

  describe("the override", () => {
    it("accepts when the cleared list names the colliding path", () => {
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);
      writeFileSync(path.join(committer, NOVEL_FILE), NOVEL);
      git(committer, ["add", NOVEL_FILE]);

      expect(
        runGuard(committer, { LISA_ALLOW_CROSS_WORKTREE_BLOB: NOVEL_FILE })
          .status
      ).toBe(0);
    });

    it("still refuses when the cleared list names a different path", () => {
      // Path-scoped on purpose: a blanket switch gets set once in frustration
      // and never unset, and the next real case passes in silence.
      const { committer, other } = buildFixture();
      writeFileSync(path.join(other, NOVEL_FILE), NOVEL);
      writeFileSync(path.join(committer, NOVEL_FILE), NOVEL);
      git(committer, ["add", NOVEL_FILE]);

      expect(
        runGuard(committer, {
          LISA_ALLOW_CROSS_WORKTREE_BLOB: "something-else.txt",
        }).status
      ).toBe(1);
    });
  });
});
