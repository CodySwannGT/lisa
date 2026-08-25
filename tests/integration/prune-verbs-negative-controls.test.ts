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
 *
 * A payload table with both-sided controls is the only bite evidence available
 * for the guard side of this change: per CodySwannGT/lisa#3111 a shell guard
 * cannot be mutation-tested, so the paired block/allow rows in
 * `safety-net-guard-fixtures` and the paired remove/refuse cases here are what
 * stand in for a mutation score.
 * @module tests/integration/prune-verbs-negative-controls
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runWorktreeClaimCli,
  runWorktreePruneCli,
} from "../../src/cli/prune-commands.js";
import { applyStashPrune, planStashPrune } from "../../src/cli/stash-prune.js";
import { probeLiveWorkingDirectories } from "../../src/cli/worktree-liveness.js";
import {
  applyWorktreePrune,
  planWorktreePrune,
  type WorktreePruneDependencies,
} from "../../src/cli/worktree-prune.js";
import type { WorktreeVerdict } from "../../src/cli/worktree-prune-policy.js";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";
import { NO_IDLE_WINDOW, usePruneFixtures } from "../support/prune-fixtures.js";

const fixtures = usePruneFixtures();

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
      const root = await fixtures.createPublishedRepo();
      const finished = fixtures.addPublishedWorktree(root, "finished");
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
      const root = await fixtures.createPublishedRepo();
      const sibling = fixtures.addPublishedWorktree(root, "sibling");
      await fixtures.holdDirectoryOpen(sibling);
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
      const root = await fixtures.createPublishedRepo();
      const atRisk = fixtures.addPublishedWorktree(root, "at-risk");
      writeFileSync(path.join(atRisk, "file.txt"), "committed but unpushed\n");
      fixtures.runGit(["commit", "-q", "-am", "unpushed work"], atRisk);
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
      expect(fixtures.runGit(["log", "-1", "--format=%s"], atRisk)).toBe(
        "unpushed work"
      );
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "never removes the primary checkout or the worktree it runs from",
    async () => {
      const root = await fixtures.createPublishedRepo();
      const here = fixtures.addPublishedWorktree(root, "here");
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
      const root = await fixtures.createPublishedRepo();
      writeFileSync(path.join(root, "file.txt"), "real human work\n");
      fixtures.runGit(["stash", "push", "-q", "-m", "real work"], root);
      writeFileSync(path.join(root, "file.txt"), "machine backup\n");
      fixtures.runGit(
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

      const remaining = fixtures.runGit(["stash", "list"], root);
      expect(remaining).toContain("real work");
      expect(remaining).not.toContain("lint-staged automatic backup");

      const preservedRef = outcomes[0]?.preservedRef ?? "";
      expect(preservedRef).toContain("refs/lisa/pruned-stashes/");
      expect(
        fixtures.runGit(["rev-parse", "--verify", preservedRef], root)
      ).toBe(outcomes[0]?.sha);
      fixtures.runGit(["stash", "apply", preservedRef], root);
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
      const root = await fixtures.createPublishedRepo();
      const finished = fixtures.addPublishedWorktree(root, "finished");
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
      const root = await fixtures.createPublishedRepo();
      const mine = fixtures.addPublishedWorktree(root, "mine");
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
      const root = await fixtures.createPublishedRepo();
      const mine = fixtures.addPublishedWorktree(root, "mine");
      await runWorktreeClaimCli(mine, { owner: "agent-a" });
      expect(fixtures.runGit(["status", "--porcelain"], mine)).toBe("");
    },
    ioLatencyBudgetMs(120_000)
  );
});
