/**
 * Tests for the live-process probe (CodySwannGT/lisa#2993).
 *
 * The probe is what replaces a path-prefix guess with evidence, so the cases
 * that matter are containment (a sibling directory sharing a prefix is NOT
 * inside) and unavailability (no answer must never read as "nothing is live").
 * @module tests/unit/cli/worktree-liveness
 */
import { describe, expect, it } from "vitest";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import {
  countLiveHolders,
  isInside,
  LSOF_CANDIDATES,
  parseLsofWorkingDirectories,
  probeLiveWorkingDirectories,
} from "../../../src/cli/worktree-liveness.js";

/** A worktree path, plus a prefix-sharing sibling that must never match it. */
const WORKTREE = "/workspace/wt-1";

describe("isInside", () => {
  it("treats a directory as inside itself", () => {
    expect(isInside(WORKTREE, WORKTREE)).toBe(true);
  });

  it("treats a descendant as inside", () => {
    expect(isInside(WORKTREE, "/workspace/wt-1/src/cli")).toBe(true);
  });

  it("does NOT treat a prefix-sharing sibling as inside", () => {
    expect(isInside(WORKTREE, "/workspace/wt-10")).toBe(false);
    expect(isInside("/workspace/wt-2", "/workspace/wt-28/src")).toBe(false);
  });

  it("does not treat a parent as inside its child", () => {
    expect(isInside("/workspace/wt-1/src", WORKTREE)).toBe(false);
  });
});

describe("countLiveHolders", () => {
  it("counts only the working directories inside the worktree", () => {
    expect(
      countLiveHolders(WORKTREE, [
        WORKTREE,
        "/workspace/wt-1/src",
        "/workspace/wt-10",
        "/elsewhere",
      ])
    ).toBe(2);
  });

  it("counts zero when nothing is inside", () => {
    expect(countLiveHolders(WORKTREE, ["/workspace/wt-2"])).toBe(0);
  });
});

describe("parseLsofWorkingDirectories", () => {
  it("keeps only absolute name fields and deduplicates them", () => {
    expect(
      parseLsofWorkingDirectories(
        ["p101", "n/workspace/wt-1", "p102", "n/workspace/wt-1", "n/tmp"].join(
          "\n"
        )
      )
    ).toEqual([WORKTREE, "/tmp"]);
  });

  it("ignores non-absolute and non-name records", () => {
    expect(
      parseLsofWorkingDirectories(["p101", "nunknown", "ftxt"].join("\n"))
    ).toEqual([]);
  });
});

describe("probeLiveWorkingDirectories", () => {
  it("names fixed absolute lsof locations rather than trusting PATH", () => {
    expect(LSOF_CANDIDATES.every(candidate => candidate.startsWith("/"))).toBe(
      true
    );
  });

  it("returns undefined rather than an empty list when it exhausts its candidates", async () => {
    expect(
      await probeLiveWorkingDirectories(LSOF_CANDIDATES.length)
    ).toBeUndefined();
  });

  it(
    "finds this process's own working directory on a real machine",
    async () => {
      const directories = await probeLiveWorkingDirectories();
      expect(directories).toBeDefined();
      expect(
        countLiveHolders(process.cwd(), directories ?? [])
      ).toBeGreaterThan(0);
    },
    ioLatencyBudgetMs(60_000)
  );
});
