/**
 * Negative controls for Lisa's cleanup verbs, against real git (lisa#2993).
 *
 * The unit suites pin the entitlement rules as pure functions. These tests pin
 * the two outcomes that make the difference between a cleaner and an incident,
 * end to end, with a real repository, real worktrees, a real live process, and
 * the real removal path:
 *
 *   1. a sibling worktree somebody is working in RIGHT NOW is not removed;
 *   2. a worktree holding unpushed commits and uncommitted edits is not
 *      silently discarded — the standing rule in this repository is that
 *      stash-before-destroy is the only acceptable route for uncommitted work.
 *
 * The live-process control uses the REAL machine-wide probe rather than a stub,
 * because a stubbed probe would prove the rule and not the wiring, and the
 * wiring is where a path-prefix answer would sneak back in.
 * @module tests/integration/prune-verbs-negative-controls
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyStashPrune, planStashPrune } from "../../src/cli/stash-prune.js";
import {
  runWorktreeClaimCli,
  runWorktreePruneCli,
} from "../../src/cli/prune-commands.js";
import { probeLiveWorkingDirectories } from "../../src/cli/worktree-liveness.js";
import {
  applyWorktreePrune,
  planWorktreePrune,
  type WorktreePruneDependencies,
} from "../../src/cli/worktree-prune.js";
import type { WorktreeVerdict } from "../../src/cli/worktree-prune-policy.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

/** Zero quiescence, so a fixture's freshness never masks the real blocker. */
const NO_IDLE_WINDOW = { idleHours: "0" };

const temporaryDirectories: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  children.splice(0).forEach(child => {
    child.kill("SIGKILL");
  });
  const dirs = temporaryDirectories.splice(0);
  for (const dir of dirs) {
    await cleanupTempDir(dir);
  }
});

/**
 * Run one git command against a fixture.
 * @param args - Git arguments
 * @param cwd - Directory to run in
 * @returns Trimmed stdout
 */
function runGit(args: readonly string[], cwd: string): string {
  const outcome = boundedSpawnSync({
    label: `git ${args[0] ?? ""}`,
    command: GIT_BIN,
    args,
    cwd,
    env: { ...cleanGitEnv(), ...IDENTITY },
  });
  return (outcome.stdout ?? "").trim();
}

/**
 * Build a repository with a remote, one commit, and everything published.
 * @returns Absolute path of the primary checkout
 */
async function createPublishedRepo(): Promise<string> {
  const temporary = realpathSync.native(await createTempDir());
  const remote = path.join(temporary, "remote.git");
  const root = path.join(temporary, "primary");
  temporaryDirectories.push(temporary);
  runGit(["init", "-q", "--bare", remote], temporary);
  runGit(["init", "-q", "-b", "main", root], temporary);
  writeFileSync(path.join(root, "file.txt"), "one\n", "utf8");
  runGit(["add", "."], root);
  runGit(["commit", "-q", "-m", "init"], root);
  runGit(["remote", "add", "origin", remote], root);
  runGit(["push", "-q", "-u", "origin", "main"], root);
  return root;
}

/**
 * Add a worktree on a branch that is already published.
 * @param root - Primary checkout
 * @param name - Worktree directory name
 * @returns Absolute worktree path
 */
function addPublishedWorktree(root: string, name: string): string {
  const worktree = path.join(root, ".worktrees", name);
  runGit(["worktree", "add", "-q", "-b", name, worktree, "main"], root);
  runGit(["push", "-q", "-u", "origin", name], worktree);
  return worktree;
}

/**
 * Spawn a live process sitting inside a directory and wait for it to appear.
 * @param cwd - Directory the process should hold open
 * @returns Nothing; the child is killed after the test
 */
async function holdDirectoryOpen(cwd: string): Promise<void> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
  children.push(child);
  await new Promise(resolve => {
    setTimeout(resolve, 500);
  });
}

/**
 * Dependencies wired to the real liveness probe and a fixed identity.
 * @param currentPath - Path the cleaner should believe it runs from
 * @returns Prune dependencies
 */
function realProbeDependencies(currentPath: string): WorktreePruneDependencies {
  return {
    probeLive: probeLiveWorkingDirectories,
    callerOwnerId: undefined,
    now: () => Date.now(),
    currentPath,
  };
}

/**
 * Find the verdict for one worktree.
 * @param verdicts - Verdicts from a plan
 * @param worktree - Absolute worktree path
 * @returns The matching verdict
 */
function verdictFor(
  verdicts: readonly WorktreeVerdict[],
  worktree: string
): WorktreeVerdict {
  const found = verdicts.find(verdict => verdict.path === worktree);
  expect(found).toBeDefined();
  return found as WorktreeVerdict;
}

describe("lisa worktree prune against real git", () => {
  it(
    "removes a quiescent worktree whose branch is fully published",
    async () => {
      const root = await createPublishedRepo();
      const finished = addPublishedWorktree(root, "finished");
      const plan = await planWorktreePrune(
        root,
        NO_IDLE_WINDOW,
        realProbeDependencies(root)
      );
      expect(verdictFor(plan.verdicts, finished).eligible).toBe(true);
      const outcomes = await applyWorktreePrune(plan);
      expect(outcomes).toEqual([{ path: finished, removed: true }]);
      expect(existsSync(finished)).toBe(false);
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "does NOT remove a sibling worktree a live process is working inside",
    async () => {
      const root = await createPublishedRepo();
      const sibling = addPublishedWorktree(root, "sibling");
      await holdDirectoryOpen(sibling);
      const plan = await planWorktreePrune(
        root,
        NO_IDLE_WINDOW,
        realProbeDependencies(root)
      );
      const verdict = verdictFor(plan.verdicts, sibling);
      expect(verdict.eligible).toBe(false);
      expect(verdict.blockers).toContain("in-use");
      expect(await applyWorktreePrune(plan)).toEqual([]);
      expect(existsSync(sibling)).toBe(true);
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "does NOT discard a worktree holding unpushed commits and uncommitted edits",
    async () => {
      const root = await createPublishedRepo();
      const atRisk = addPublishedWorktree(root, "at-risk");
      writeFileSync(path.join(atRisk, "file.txt"), "committed but unpushed\n");
      runGit(["commit", "-q", "-am", "unpushed work"], atRisk);
      writeFileSync(path.join(atRisk, "file.txt"), "uncommitted work\n");
      writeFileSync(path.join(atRisk, "new.txt"), "untracked work\n");

      const plan = await planWorktreePrune(
        root,
        NO_IDLE_WINDOW,
        realProbeDependencies(root)
      );
      const verdict = verdictFor(plan.verdicts, atRisk);
      expect(verdict.eligible).toBe(false);
      expect(verdict.blockers).toContain("unpushed-commits");
      expect(verdict.blockers).toContain("uncommitted-changes");

      expect(await applyWorktreePrune(plan)).toEqual([]);
      expect(existsSync(atRisk)).toBe(true);
      expect(readFileSync(path.join(atRisk, "file.txt"), "utf8")).toBe(
        "uncommitted work\n"
      );
      expect(readFileSync(path.join(atRisk, "new.txt"), "utf8")).toBe(
        "untracked work\n"
      );
      expect(runGit(["log", "-1", "--format=%s"], atRisk)).toBe(
        "unpushed work"
      );
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "never removes the primary checkout or the worktree it runs from",
    async () => {
      const root = await createPublishedRepo();
      const here = addPublishedWorktree(root, "here");
      const plan = await planWorktreePrune(
        root,
        NO_IDLE_WINDOW,
        realProbeDependencies(here)
      );
      expect(verdictFor(plan.verdicts, root).blockers).toContain(
        "primary-checkout"
      );
      expect(verdictFor(plan.verdicts, here).blockers).toContain(
        "current-worktree"
      );
      expect(await applyWorktreePrune(plan)).toEqual([]);
      expect(existsSync(root)).toBe(true);
      expect(existsSync(here)).toBe(true);
    },
    ioLatencyBudgetMs(120_000)
  );
});

describe("lisa stash prune against real git", () => {
  it(
    "drops aged machine debris, keeps real work, and preserves what it drops",
    async () => {
      const root = await createPublishedRepo();
      writeFileSync(path.join(root, "file.txt"), "real human work\n");
      runGit(["stash", "push", "-q", "-m", "real work"], root);
      writeFileSync(path.join(root, "file.txt"), "machine backup\n");
      runGit(
        [
          "-c",
          "user.name=t",
          "stash",
          "push",
          "-q",
          "-m",
          "lint-staged automatic backup",
        ],
        root
      );

      const twoDaysOn = () => Date.now() + 2 * 24 * 60 * 60 * 1000;
      const plan = await planStashPrune(root, {}, twoDaysOn);
      expect(plan.verdicts).toHaveLength(2);
      const debris = plan.verdicts.find(
        verdict => verdict.redundancy === "machine-debris"
      );
      expect(debris).toBeDefined();
      expect(plan.verdicts.filter(verdict => verdict.eligible)).toHaveLength(1);

      const outcomes = await applyStashPrune(plan);
      expect(outcomes.every(outcome => outcome.dropped)).toBe(true);

      const remaining = runGit(["stash", "list"], root);
      expect(remaining).toContain("real work");
      expect(remaining).not.toContain("lint-staged automatic backup");

      const preservedRef = outcomes[0]?.preservedRef ?? "";
      expect(preservedRef).toContain("refs/lisa/pruned-stashes/");
      expect(runGit(["rev-parse", "--verify", preservedRef], root)).toBe(
        outcomes[0]?.sha
      );
      runGit(["stash", "apply", preservedRef], root);
      expect(readFileSync(path.join(root, "file.txt"), "utf8")).toBe(
        "machine backup\n"
      );
    },
    ioLatencyBudgetMs(120_000)
  );
});

describe("the CLI runners", () => {
  it(
    "removes nothing when --apply is absent",
    async () => {
      const root = await createPublishedRepo();
      const finished = addPublishedWorktree(root, "finished");
      const code = await runWorktreePruneCli(root, {
        ...NO_IDLE_WINDOW,
        json: true,
      });
      expect(code).toBe(0);
      expect(existsSync(finished)).toBe(true);
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "lets a claim make a fresh worktree of the caller's own eligible",
    async () => {
      const root = await createPublishedRepo();
      const mine = addPublishedWorktree(root, "mine");
      expect(await runWorktreeClaimCli(mine, { owner: "agent-a" })).toBe(0);

      const asOwner = await planWorktreePrune(
        root,
        {},
        {
          ...realProbeDependencies(root),
          callerOwnerId: "agent-a",
        }
      );
      expect(verdictFor(asOwner.verdicts, mine).eligible).toBe(true);

      const asStranger = await planWorktreePrune(
        root,
        {},
        {
          ...realProbeDependencies(root),
          callerOwnerId: "agent-b",
        }
      );
      expect(verdictFor(asStranger.verdicts, mine).blockers).toContain(
        "claimed-by-another-owner"
      );
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "writes the claim inside the control plane, leaving the tree clean",
    async () => {
      const root = await createPublishedRepo();
      const mine = addPublishedWorktree(root, "mine");
      await runWorktreeClaimCli(mine, { owner: "agent-a" });
      expect(runGit(["status", "--porcelain"], mine)).toBe("");
    },
    ioLatencyBudgetMs(120_000)
  );
});
