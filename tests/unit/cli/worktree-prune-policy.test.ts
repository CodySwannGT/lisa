/**
 * Tests for the worktree entitlement rule (CodySwannGT/lisa#2993).
 *
 * The rule is the whole safety story of `lisa worktree prune`, so it is tested
 * as a pure function rather than through the command. Every scenario here is a
 * case where getting the answer wrong deletes somebody else's work.
 * @module tests/unit/cli/worktree-prune-policy
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKER_EXPLANATIONS,
  classifyWorktree,
  DEFAULT_MIN_IDLE_SECONDS,
  type WorktreeFacts,
} from "../../../src/cli/worktree-prune-policy.js";

/** Blocker names asserted often enough to be worth naming once. */
const UNPUSHED = "unpushed-commits";
const UNCOMMITTED = "uncommitted-changes";

const POLICY = { minIdleSeconds: 86_400 };

/**
 * Build facts for a worktree that is eligible in every respect.
 * @param overrides - Facts to change
 * @returns Facts for the entitlement rule
 */
function abandonedWorktree(
  overrides: Partial<WorktreeFacts> = {}
): WorktreeFacts {
  return {
    path: "/w/one",
    branch: "feature",
    isPrimary: false,
    isCurrent: false,
    locked: false,
    readable: true,
    ownership: "unclaimed",
    liveHolders: 0,
    idleSeconds: 200_000,
    trackedChanges: 0,
    untrackedFiles: 0,
    unpushedCommits: 0,
    ...overrides,
  };
}

describe("classifyWorktree", () => {
  it("removes a quiescent worktree whose work is entirely published", () => {
    expect(classifyWorktree(abandonedWorktree(), POLICY)).toEqual({
      path: "/w/one",
      eligible: true,
      blockers: [],
    });
  });

  it("refuses a worktree a live process is working inside", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ liveHolders: 1 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain("in-use");
  });

  it("refuses every worktree when the liveness probe could not run", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ liveHolders: undefined }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain("liveness-unknown");
  });

  it("refuses a worktree holding commits that exist on no remote", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ unpushedCommits: 3 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain(UNPUSHED);
  });

  it("refuses a worktree holding uncommitted tracked changes", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ trackedChanges: 2 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain(UNCOMMITTED);
  });

  it("refuses a worktree holding only untracked files", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ untrackedFiles: 1 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain(UNCOMMITTED);
  });

  it("reports every unmet proof rather than stopping at the first", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({
        liveHolders: 2,
        idleSeconds: 5,
        trackedChanges: 1,
        unpushedCommits: 1,
      }),
      POLICY
    );
    expect(verdict.blockers).toEqual([
      "in-use",
      "recently-active",
      UNPUSHED,
      UNCOMMITTED,
    ]);
  });

  it("refuses a worktree claimed by a different owner", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ ownership: "theirs" }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain("claimed-by-another-owner");
  });

  it("refuses a recently active worktree that nobody has claimed", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ idleSeconds: 60 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual(["recently-active"]);
  });

  it("lets the caller's own claim waive the quiescence window", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ idleSeconds: 60, ownership: "mine" }),
      POLICY
    );
    expect(verdict.eligible).toBe(true);
  });

  it("never lets a claim waive the live-process check", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ ownership: "mine", liveHolders: 1 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain("in-use");
  });

  it("never lets a claim waive uncommitted or unpushed work", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({
        ownership: "mine",
        trackedChanges: 1,
        unpushedCommits: 1,
      }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual([UNPUSHED, UNCOMMITTED]);
  });

  it("refuses the primary checkout and the worktree it is running in", () => {
    expect(
      classifyWorktree(abandonedWorktree({ isPrimary: true }), POLICY).blockers
    ).toContain("primary-checkout");
    expect(
      classifyWorktree(abandonedWorktree({ isCurrent: true }), POLICY).blockers
    ).toContain("current-worktree");
  });

  it("refuses a locked worktree", () => {
    expect(
      classifyWorktree(abandonedWorktree({ locked: true }), POLICY).blockers
    ).toContain("git-locked");
  });

  it("refuses a worktree git could not report on, despite its zeroed counts", () => {
    const verdict = classifyWorktree(
      abandonedWorktree({ readable: false }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toContain("unreadable");
  });

  it("defaults the quiescence window to a full day", () => {
    expect(DEFAULT_MIN_IDLE_SECONDS).toBe(86_400);
  });

  it("explains every blocker it can emit", () => {
    const emitted = classifyWorktree(
      abandonedWorktree({
        readable: false,
        isPrimary: true,
        isCurrent: true,
        locked: true,
        ownership: "theirs",
        liveHolders: undefined,
        idleSeconds: 0,
        trackedChanges: 1,
        unpushedCommits: 1,
      }),
      POLICY
    ).blockers;
    expect(emitted.length).toBe(9);
    emitted.forEach(blocker => {
      expect(BLOCKER_EXPLANATIONS[blocker]).toBeTruthy();
    });
  });
});
