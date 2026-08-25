/**
 * Parsing and reporting for Lisa's cleanup verbs (CodySwannGT/lisa#2993).
 *
 * The parsers decide which worktrees and stash entries the entitlement rules
 * ever see, so a record dropped here is a candidate that silently never gets
 * assessed — and the report is the only place an operator learns what was left
 * behind and why.
 * @module tests/unit/cli/prune-parsing
 */
import { describe, expect, it } from "vitest";
import {
  describeStashVerdict,
  describeWorktreeVerdict,
  renderStashPlan,
  renderWorktreePlan,
} from "../../../src/cli/prune-report.js";
import {
  parseStashList,
  preservedStashRef,
  resolveMinDebrisAgeSeconds,
} from "../../../src/cli/stash-prune.js";
import { parseWorktreeList } from "../../../src/cli/worktree-inventory.js";
import { resolveMinIdleSeconds } from "../../../src/cli/worktree-prune.js";

const UNIT_SEPARATOR = "\u001F";

/** One worktree path and one stash id, each asserted from several angles. */
const WORKTREE_PATH = "/repo/.worktrees/one";
const STASH_SHA = "abcdef0123456789";
const MACHINE_DEBRIS = "machine-debris";

const PORCELAIN = [
  "worktree /repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /repo/.worktrees/feature",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/feature",
  "locked being used by an agent",
  "",
  "worktree /repo/.worktrees/gone",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "prunable gitdir file points to non-existent location",
  "",
].join("\n");

describe("parseWorktreeList", () => {
  it("marks only the first record as the primary checkout", () => {
    const entries = parseWorktreeList(PORCELAIN);
    expect(entries.map(entry => entry.isPrimary)).toEqual([true, false, false]);
  });

  it("strips the refs/heads prefix from branch names", () => {
    expect(parseWorktreeList(PORCELAIN)[1]?.branch).toBe("feature");
  });

  it("reports a detached worktree with no branch at all", () => {
    expect(parseWorktreeList(PORCELAIN)[2]?.branch).toBeUndefined();
  });

  it("carries git's own locked and prunable flags through", () => {
    const entries = parseWorktreeList(PORCELAIN);
    expect(entries[1]?.locked).toBe(true);
    expect(entries[2]?.prunable).toBe(true);
    expect(entries[0]?.locked).toBe(false);
  });

  it("parses nothing out of empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("parseStashList", () => {
  it("splits the commit id, subject, and timestamp", () => {
    expect(
      parseStashList(
        [
          [
            "aaa111",
            "On main: lint-staged automatic backup",
            "1700000000",
          ].join(UNIT_SEPARATOR),
          ["bbb222", "WIP on main: real work", "1700000100"].join(
            UNIT_SEPARATOR
          ),
        ].join("\n")
      )
    ).toEqual([
      {
        sha: "aaa111",
        subject: "On main: lint-staged automatic backup",
        timestamp: 1_700_000_000,
      },
      {
        sha: "bbb222",
        subject: "WIP on main: real work",
        timestamp: 1_700_000_100,
      },
    ]);
  });

  it("parses nothing out of empty output", () => {
    expect(parseStashList("")).toEqual([]);
  });
});

describe("threshold parsing", () => {
  it("converts hours to seconds", () => {
    expect(resolveMinIdleSeconds("2")).toBe(7200);
    expect(resolveMinDebrisAgeSeconds("0.5")).toBe(1800);
  });

  it("defaults to a full day when the flag is absent", () => {
    expect(resolveMinIdleSeconds(undefined)).toBe(86_400);
    expect(resolveMinDebrisAgeSeconds(undefined)).toBe(86_400);
  });

  it("refuses a value that is not a non-negative number", () => {
    expect(() => resolveMinIdleSeconds("soon")).toThrow(
      "--idle-hours must be a non-negative number"
    );
    expect(() => resolveMinDebrisAgeSeconds("-1")).toThrow(
      "--older-than-hours must be a non-negative number"
    );
  });
});

describe("preservedStashRef", () => {
  it("anchors a dropped stash under the Lisa namespace", () => {
    expect(preservedStashRef("abc123")).toBe("refs/lisa/pruned-stashes/abc123");
  });
});

describe("prune reports", () => {
  it("names every reason a worktree was kept", () => {
    expect(
      describeWorktreeVerdict({
        path: WORKTREE_PATH,
        eligible: false,
        blockers: ["in-use", "uncommitted-changes"],
      })
    ).toContain("live process is working inside it right now");
  });

  it("marks an eligible worktree for removal", () => {
    expect(
      describeWorktreeVerdict({
        path: WORKTREE_PATH,
        eligible: true,
        blockers: [],
      })
    ).toContain("REMOVE");
  });

  it("names the redundancy proof behind a droppable stash", () => {
    expect(
      describeStashVerdict({
        index: 0,
        sha: STASH_SHA,
        eligible: true,
        redundancy: MACHINE_DEBRIS,
        blockers: [],
      })
    ).toContain(MACHINE_DEBRIS);
  });

  it("names why a stash was kept", () => {
    expect(
      describeStashVerdict({
        index: 1,
        sha: STASH_SHA,
        eligible: false,
        blockers: ["not-provably-redundant"],
      })
    ).toContain("not provably preserved anywhere else");
  });

  it("says plainly that a dry run removed nothing", () => {
    const lines = renderWorktreePlan(
      {
        repoPath: "/repo",
        verdicts: [{ path: WORKTREE_PATH, eligible: true, blockers: [] }],
        facts: [],
        livenessAvailable: true,
        prunableRegistrations: [],
      },
      false
    );
    expect(lines.join("\n")).toContain("dry run");
    expect(lines.join("\n")).toContain("--apply");
  });

  it("warns that an unavailable liveness probe means unassessed, not clean", () => {
    const lines = renderWorktreePlan(
      {
        repoPath: "/repo",
        verdicts: [],
        facts: [],
        livenessAvailable: false,
        prunableRegistrations: [],
      },
      false
    );
    expect(lines.join("\n")).toContain("unassessed, not clean");
  });

  it("tells the operator how to restore anything it dropped", () => {
    const lines = renderStashPlan(
      {
        repoPath: "/repo",
        verdicts: [
          {
            index: 0,
            sha: STASH_SHA,
            eligible: true,
            redundancy: MACHINE_DEBRIS,
            blockers: [],
          },
        ],
        facts: [],
      },
      true
    );
    expect(lines.join("\n")).toContain("git stash apply");
  });
});
