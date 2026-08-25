/**
 * Tests for the ruleset branch-reach detector.
 *
 * A ruleset whose include patterns match no branch is live, active, and
 * governs nothing — and every surface that touches ruleset conditions reads it
 * as healthy, because each compares the include list against a TEMPLATE and
 * never against the repository's actual heads. CodySwannGT/lisa#2781.
 *
 * The branch lists here are written out literally rather than derived from the
 * module under test. A test that asked the matcher which branches it matched
 * and then asserted that answer would pass through any change to the matcher,
 * which is the change that would silently stop reporting a dead gate.
 * @module tests/unit/scripts/lisa-ruleset-reach
 */

import { describe, expect, it } from "vitest";

import {
  ZERO_REACH_HEADING,
  globToRegExp,
  refPatternMatches,
  renderReachReport,
  rulesetReach,
  sweepRulesetReach,
} from "../../../scripts/lisa-ruleset-reach.mjs";

/** The ruleset from the defect: its whole include list names one dead ref. */
const DEAD_RULESET = "nightly e2e health";

/** Its sibling in the same directory, which governs the default branch. */
const LIVE_RULESET = "bdd coverage";

/** The include entry naming a branch the fixture repository does not have. */
const DEAD_PATTERN = "refs/heads/dev";

/** The include entry that follows the repository's default branch. */
const DEFAULT_PATTERN = "~DEFAULT_BRANCH";

/** The fixture repository's default branch. */
const DEFAULT_BRANCH = "main";

/** The verdict for a ruleset that governs nothing. */
const ZERO_REACH = "zero-reach";

/** The verdict for a ruleset this run could not classify. */
const UNDETERMINED = "undetermined";

/** The one feature branch the fixture repository has. */
const FEATURE_BRANCH = "feature/login";

/** The include entry that expands over every feature branch. */
const FEATURE_PATTERN = "refs/heads/feature/*";

/** The fully qualified spelling of the default branch. */
const MAIN_PATTERN = "refs/heads/main";

/** A repository whose only long-lived branches are these three. */
const BRANCHES = [
  DEFAULT_BRANCH,
  FEATURE_BRANCH,
  "releases/v1/hotfix",
] as const;

/**
 * Builds one active branch ruleset with the given include/exclude entries.
 *
 * @param name Ruleset name.
 * @param include Include entries.
 * @param exclude Exclude entries.
 * @returns A detailed ruleset payload.
 */
function ruleset(
  name: string,
  include: readonly string[],
  exclude: readonly string[] = []
): Record<string, unknown> {
  return {
    name,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: [...include], exclude: [...exclude] } },
  };
}

describe("rulesetReach", () => {
  // THE DEFECT. The shipped nightly E2E health ruleset's whole include list is
  // ["refs/heads/dev"], and a repository whose only branch is its default
  // therefore has an active ruleset requiring a context on a ref that does not
  // exist. GitHub accepts it, nothing validates it, and the operator finds out
  // when they are blocked — or never.
  it("reports a ruleset whose only include names a branch that does not exist", () => {
    expect(
      rulesetReach({
        ruleset: ruleset(DEAD_RULESET, [DEAD_PATTERN]),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      })
    ).toEqual({
      name: DEAD_RULESET,
      verdict: ZERO_REACH,
      patterns: [DEAD_PATTERN],
      matched: [],
      reason: "no branch in this repository matches its include patterns",
    });
  });

  // THE NEGATIVE CONTROL, and the reason the report is worth reading. Its
  // sibling in the same directory includes ~DEFAULT_BRANCH, which is the same
  // stack, the same author, and the same directory — so a detector that
  // flagged this one too would be reporting a convention as a defect.
  it("stays silent for a ruleset that governs the default branch", () => {
    expect(
      rulesetReach({
        ruleset: ruleset(LIVE_RULESET, [DEFAULT_PATTERN]),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      })
    ).toEqual({
      name: LIVE_RULESET,
      verdict: "governs",
      patterns: [DEFAULT_PATTERN],
      matched: ["main"],
      reason: "",
    });
  });

  // A dead entry beside a live one is harmless — that is exactly the state of
  // this repository's own base ruleset, whose includes name `dev` and
  // `staging` alongside `~DEFAULT_BRANCH` and `main`. Flagging it would train
  // an operator to ignore the report before it ever finds a real one.
  it("stays silent when one include entry is dead and another governs", () => {
    const answer = rulesetReach({
      ruleset: ruleset("base", [
        DEFAULT_PATTERN,
        DEAD_PATTERN,
        "refs/heads/staging",
        MAIN_PATTERN,
      ]),
      branches: BRANCHES,
      defaultBranch: DEFAULT_BRANCH,
    });

    expect(answer.verdict).toBe("governs");
    expect(answer.matched).toEqual(["main"]);
  });

  it("expands a glob include against the branches that exist", () => {
    expect(
      rulesetReach({
        ruleset: ruleset("features", [FEATURE_PATTERN]),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).matched
    ).toEqual([FEATURE_BRANCH]);
  });

  it("reports a glob include that expands to nothing", () => {
    expect(
      rulesetReach({
        ruleset: ruleset("hotfixes", ["refs/heads/hotfix/*"]),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).verdict
    ).toBe(ZERO_REACH);
  });

  it("counts an excluded branch as not governed", () => {
    expect(
      rulesetReach({
        ruleset: ruleset(
          "features",
          [FEATURE_PATTERN],
          [`refs/heads/${FEATURE_BRANCH}`]
        ),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).verdict
    ).toBe(ZERO_REACH);
  });

  // FAIL CLOSED. An unread branch list is not an empty repository, and an
  // empty branch list read is not a repository with no branches: a token
  // without the scope and a genuinely empty repository are identical from
  // here. Either one answered `governs` reports a repository clean on the
  // strength of a read that never happened.
  it.each([
    ["unread branches", undefined, "the repository's branches were not read"],
    [
      "an empty branch list",
      [],
      "no branch was readable, which is not the same as a repository with none",
    ],
  ])("answers undetermined for %s", (_label, branches, reason) => {
    expect(
      rulesetReach({
        ruleset: ruleset(DEAD_RULESET, [DEAD_PATTERN]),
        branches: branches as readonly string[] | undefined,
        defaultBranch: DEFAULT_BRANCH,
      })
    ).toMatchObject({ verdict: UNDETERMINED, reason });
  });

  // ~DEFAULT_BRANCH is the entry most rulesets rely on, so a default branch
  // this run could not resolve decides the whole verdict. Guessing it either
  // way is a claim the run cannot support.
  it("answers undetermined when ~DEFAULT_BRANCH cannot be resolved", () => {
    expect(
      rulesetReach({
        ruleset: ruleset(LIVE_RULESET, [DEFAULT_PATTERN]),
        branches: BRANCHES,
        defaultBranch: undefined,
      }).verdict
    ).toBe(UNDETERMINED);
  });

  // A default branch missing from the branch list means the list this run
  // holds is not the repository's. Every verdict drawn from it would be drawn
  // from an input already known to be wrong.
  it("answers undetermined when the default branch is absent from the list", () => {
    expect(
      rulesetReach({
        ruleset: ruleset(LIVE_RULESET, [DEFAULT_PATTERN]),
        branches: BRANCHES,
        defaultBranch: "trunk",
      })
    ).toMatchObject({
      verdict: UNDETERMINED,
      reason:
        "the default branch is missing from the branch list this run read",
    });
  });

  // Bracket expressions and brace alternation are legal fnmatch that this
  // detector does not model. Expanding one wrongly produces a false
  // zero-reach, which is the one outcome that costs an operator a trip to a
  // ruleset that is fine.
  it.each([["refs/heads/re[a-z]*"], ["refs/heads/{main,dev}"]])(
    "answers undetermined for the unmodelled pattern %s",
    pattern => {
      expect(
        rulesetReach({
          ruleset: ruleset("unmodelled", [pattern]),
          branches: BRANCHES,
          defaultBranch: DEFAULT_BRANCH,
        }).verdict
      ).toBe(UNDETERMINED);
    }
  );

  it("answers undetermined for a reserved token it has never seen", () => {
    expect(
      rulesetReach({
        ruleset: ruleset("future", ["~SOMETHING_NEW"]),
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).verdict
    ).toBe(UNDETERMINED);
  });

  it.each([
    ["conditions that are not an object", { conditions: null }],
    ["an include list that is not an array", { conditions: { ref_name: {} } }],
    ["an enforcement that is not a string", { enforcement: 7 }],
  ])("answers undetermined for %s", (_label, override) => {
    expect(
      rulesetReach({
        ruleset: { ...ruleset("broken", [DEFAULT_PATTERN]), ...override },
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).verdict
    ).toBe(UNDETERMINED);
  });

  // A disabled ruleset governing nothing is a decision somebody made, and a
  // tag-target ruleset's ref patterns name TAGS. Comparing either against a
  // branch list manufactures a finding out of correct configuration.
  it.each([
    ["a disabled ruleset", { enforcement: "disabled" }, "inactive"],
    ["a tag ruleset", { target: "tag" }, "not-branch-target"],
  ])("does not report %s as zero reach", (_label, override, verdict) => {
    expect(
      rulesetReach({
        ruleset: { ...ruleset("other", [DEAD_PATTERN]), ...override },
        branches: BRANCHES,
        defaultBranch: DEFAULT_BRANCH,
      }).verdict
    ).toBe(verdict);
  });
});

describe("refPatternMatches", () => {
  it.each([
    ["~ALL", "anything", true],
    [DEFAULT_PATTERN, DEFAULT_BRANCH, true],
    [DEFAULT_PATTERN, "other", false],
    ["refs/heads/main", DEFAULT_BRANCH, true],
    [MAIN_PATTERN, "mainline", false],
    [FEATURE_PATTERN, FEATURE_BRANCH, true],
    [FEATURE_PATTERN, "feature/login/extra", false],
    ["refs/heads/feature/**", "feature/login/extra", true],
    ["refs/heads/releases/**/*", "releases/v1", true],
    ["refs/heads/releases/**/*", "releases/v1/hotfix", true],
    ["refs/heads/mai?", DEFAULT_BRANCH, true],
  ])("matches %s against %s", (pattern, branch, expected) => {
    expect(refPatternMatches(pattern, branch, DEFAULT_BRANCH)).toBe(expected);
  });

  it.each([
    ["refs/heads/re[a-z]", "read"],
    ["~SOMETHING", "main"],
    ["dev", "dev"],
    ["", "main"],
  ])("cannot determine %s against %s", (pattern, branch) => {
    expect(refPatternMatches(pattern, branch, DEFAULT_BRANCH)).toBeNull();
  });

  // A `.` in a branch name is a literal, not "any character". Treating it as a
  // wildcard would report a ruleset as governing a branch it does not.
  it("treats regex metacharacters in a pattern literally", () => {
    expect(refPatternMatches("refs/heads/v1.0", "v1x0", DEFAULT_BRANCH)).toBe(
      false
    );
    expect(refPatternMatches("refs/heads/v1.0", "v1.0", DEFAULT_BRANCH)).toBe(
      true
    );
  });
});

describe("globToRegExp", () => {
  it("anchors the whole branch name", () => {
    expect(globToRegExp("main").test("release-main-2")).toBe(false);
  });
});

describe("renderReachReport", () => {
  const sweep = sweepRulesetReach({
    rulesets: [
      ruleset(DEAD_RULESET, [DEAD_PATTERN]),
      ruleset(LIVE_RULESET, [DEFAULT_PATTERN]),
    ],
    branches: BRANCHES,
    defaultBranch: DEFAULT_BRANCH,
  });

  it("names the ruleset and the patterns that matched nothing", () => {
    const report = renderReachReport(sweep);

    expect(report).toContain(ZERO_REACH_HEADING);
    expect(report).toContain(DEAD_RULESET);
    expect(report).toContain(DEAD_PATTERN);
  });

  it("does not name a ruleset that governs a branch", () => {
    expect(renderReachReport(sweep)).not.toContain(LIVE_RULESET);
  });

  // Report only. Creating the branch manufactures the very ref the ruleset
  // exists to protect, and disabling the ruleset gives up a protection
  // somebody chose; an automated actor may narrow a control, never loosen one.
  it("says it changed nothing and why neither repair is Lisa's to make", () => {
    const report = renderReachReport(sweep);

    expect(report).toContain("Lisa changed nothing above");
    expect(report).toContain("LOOSEN a control nobody asked to loosen");
  });

  it("prints nothing when every ruleset governs a branch", () => {
    expect(
      renderReachReport(
        sweepRulesetReach({
          rulesets: [ruleset(LIVE_RULESET, [DEFAULT_PATTERN])],
          branches: BRANCHES,
          defaultBranch: DEFAULT_BRANCH,
        })
      )
    ).toBe("");
  });

  it("says an unchecked ruleset is not a clean result", () => {
    const report = renderReachReport(
      sweepRulesetReach({
        rulesets: [ruleset(DEAD_RULESET, [DEAD_PATTERN])],
        branches: undefined,
        defaultBranch: DEFAULT_BRANCH,
      })
    );

    expect(report).toContain("was NOT checked for reach");
    expect(report).toContain("This is not a clean result");
    expect(report).not.toContain(ZERO_REACH_HEADING);
  });
});
