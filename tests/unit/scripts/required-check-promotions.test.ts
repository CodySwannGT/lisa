/**
 * Unit tests for the evidence rules of
 * scripts/check-required-check-promotions.mjs (issue #2509).
 *
 * The rule under test: **a check may only become a required status context if
 * its budget has proven headroom.** This file pins what counts as proof —
 * reproduce, then measure, then compare the ratio. The wiring half of the rule
 * (a context no job reports, a context on a path-filtered workflow) lives in
 * `required-check-promotions.wiring.test.ts`.
 *
 * Every expected value is hardcoded per the Test Isolation house rule; nothing
 * here computes an expectation by calling the function under test.
 *
 * @module tests/unit/scripts/required-check-promotions
 */
import { describe, expect, it } from "vitest";
import {
  ACTIONS_INTEGRATION_ID,
  collectDeclaredContexts,
  headroomProblems,
  MIN_HEADROOM_RATIO,
  splitContext,
} from "../../../scripts/check-required-check-promotions.mjs";
import {
  ACTIONS_ID,
  AST_GREP_CONTEXT,
  BARE_CONTEXT,
  makeRoot,
  PROBE_SUBJECT,
  provenHeadroom,
} from "./required-check-promotions-helpers.js";

/** Rule name for an evidence field that is missing or unreadable. */
const EVIDENCE_MISSING = "headroom-evidence-missing";

/** Rule name for an entry whose worst case is not below its own budget. */
const EXCEEDS_BUDGET = "headroom-worst-case-exceeds-budget";

/** Rule name for a worst case taken from a run the budget terminated. */
const MEASURED_ON_FAILING_RUN = "headroom-measured-on-failing-run";

/** Refusal text for a `proven` entry that never states its provenance. */
const PROVENANCE_MISSING_DETAIL =
  'headroom.observed_on must be "pass": the run that produced observed_worst_ms must have COMPLETED within its budget, because a duration reported alongside a timeout measures contention, not cost';

/** Refusal text for a worst case taken from a run the budget terminated. */
const MEASURED_ON_FAILING_RUN_DETAIL =
  'observed_worst_ms was taken from a run the budget terminated ("observed_on": "fail"); that duration is the starvation, not the work, and the more contended the box was the safer the budget looks — re-measure on a run that completed, in isolation';

describe("constants", () => {
  it("uses GitHub Actions' integration id", () => {
    expect(ACTIONS_INTEGRATION_ID).toBe(15_368);
  });

  it("requires at least a 2x margin between observed worst case and budget", () => {
    expect(MIN_HEADROOM_RATIO).toBe(2);
  });
});

describe("splitContext", () => {
  it("splits a reusable-workflow context into caller and called job names", () => {
    expect(splitContext(AST_GREP_CONTEXT)).toEqual({
      callerName: "🔍 Quality Checks",
      calledName: "🔎 Structural Rules",
    });
  });

  it("treats a bare context as a job in the calling workflow", () => {
    expect(splitContext(BARE_CONTEXT)).toEqual({
      callerName: BARE_CONTEXT,
      calledName: null,
    });
  });

  it("splits on the first separator only, so a job name may contain a slash", () => {
    expect(splitContext("A / B / C")).toEqual({
      callerName: "A",
      calledName: "B / C",
    });
  });
});

describe("collectDeclaredContexts", () => {
  it("reads contexts out of every ruleset template", () => {
    const root = makeRoot({
      required: { "🔍 Quality Checks / 🧹 Lint": ACTIONS_ID },
    });
    expect(collectDeclaredContexts(root)).toEqual([
      {
        context: "🔍 Quality Checks / 🧹 Lint",
        integrationId: 15_368,
        source: "typescript/github-rulesets/quality-checks.json",
      },
    ]);
  });

  it("also reads the per-repo addRequiredChecks opt-in, which is not templated", () => {
    // The #2476 defect: a Lisa-only context lives in `.lisa.config.json`, never
    // in a shared template, because host projects would inherit a context they
    // never report. A guard blind to that surface would clear it silently.
    const root = makeRoot({
      lisaConfig: {
        github: {
          rulesets: {
            addRequiredChecks: {
              "quality checks": [{ context: BARE_CONTEXT }],
            },
          },
        },
      },
    });
    expect(collectDeclaredContexts(root)).toEqual([
      {
        context: BARE_CONTEXT,
        integrationId: 15_368,
        source: ".lisa.config.json",
      },
    ]);
  });
});

describe("headroomProblems", () => {
  it("accepts a fully evidenced proven block", () => {
    expect(headroomProblems(provenHeadroom())).toEqual([]);
  });

  it("refuses a proven claim with no reproduction", () => {
    const headroom = { ...provenHeadroom(), reproduced: "" };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EVIDENCE_MISSING,
        detail:
          "headroom.reproduced must describe the run that reproduced the failure the budget prevents",
      },
    ]);
  });

  it("refuses a proven claim with no machine conditions", () => {
    // A figure without its conditions is not a measurement: #2490 reported
    // check-learnings-budget at 45.8s "in isolation" while ~56 sibling vitest
    // processes were live, and that retracted number nearly shipped as a
    // permanent comment.
    const { conditions: _drop, ...headroom } = provenHeadroom();
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EVIDENCE_MISSING,
        detail:
          "headroom.conditions must state the machine state the measurement was taken under",
      },
    ]);
  });

  it("refuses a margin thinner than 2x, which is what no headroom looks like", () => {
    // learnings-writer failed at 10,259ms against 10,000ms — 2.6% over — then
    // passed 5/5 unchanged. plugin-sync-scripts consumed 92% of its budget and
    // failed 15 of 16. The only budget in this repo proven under load left
    // ~2.5x. So the floor sits inside (1.09, 2.54].
    const headroom = {
      ...provenHeadroom(),
      budget_ms: 10_000,
      observed_worst_ms: 9_200,
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: "headroom-ratio-too-thin",
        detail:
          "observed worst 9200ms against a 10000ms budget is 1.09x; 2x is the floor",
      },
    ]);
  });

  it("refuses a worst case at or above the budget as an impossible claim, not a thin margin", () => {
    // #2523 cited 60,245ms as its observed worst case while setting the budget
    // to 60,000ms. The ratio rule already rejects that arithmetically at
    // 0.996x — but it reports a THIN MARGIN when the defect is an IMPOSSIBLE
    // CLAIM, and a message that misnames the defect sends the reader off to
    // re-measure when they should be re-reading. One comparison catches it
    // without knowing anything about the test.
    const headroom = {
      ...provenHeadroom(),
      budget_ms: 60_000,
      observed_worst_ms: 60_245,
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EXCEEDS_BUDGET,
        detail:
          "observed worst 60245ms is not below the 60000ms budget it justifies, so the entry disproves itself; a worst case at or above its own budget is usually elapsed time from a run the budget terminated, which measures contention rather than cost (#2528)",
      },
    ]);
  });

  it("refuses a worst case exactly equal to the budget", () => {
    // Equality is the boundary: a budget that exactly accommodates its own
    // worst case accommodates nothing, and 1.00x reads as a rounding argument
    // rather than as the contradiction it is.
    const headroom = {
      ...provenHeadroom(),
      budget_ms: 60_000,
      observed_worst_ms: 60_000,
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EXCEEDS_BUDGET,
        detail:
          "observed worst 60000ms is not below the 60000ms budget it justifies, so the entry disproves itself; a worst case at or above its own budget is usually elapsed time from a run the budget terminated, which measures contention rather than cost (#2528)",
      },
    ]);
  });

  it("refuses an impossible claim inside a budgets[] entry as well", () => {
    const headroom = {
      ...provenHeadroom(),
      budgets: [
        {
          subject: PROBE_SUBJECT,
          budget_ms: 60_000,
          observed_worst_ms: 60_245,
          observed_on: "pass",
          measured_on_subject: PROBE_SUBJECT,
        },
      ],
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EXCEEDS_BUDGET,
        detail:
          "observed worst 60245ms is not below the 60000ms budget it justifies, so the entry disproves itself; a worst case at or above its own budget is usually elapsed time from a run the budget terminated, which measures contention rather than cost (#2528)",
      },
    ]);
  });

  it("refuses a worst case taken from a run the budget terminated", () => {
    // The mirror of the rule #2509 already enforces. #2509: do not size from
    // runs that PASSED, because the sample excludes the failure mode. Here: do
    // not size from the DURATION of a run that failed ON TIME, because that
    // duration is the starvation, not the work. #2523's 60,245ms was wall clock
    // spent waiting; the same test measured in isolation at load 31 takes
    // 2,499ms — a 24-fold difference, in the unsafe direction.
    const headroom = { ...provenHeadroom(), observed_on: "fail" };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: MEASURED_ON_FAILING_RUN,
        detail: MEASURED_ON_FAILING_RUN_DETAIL,
      },
    ]);
  });

  it("refuses a proven claim that never says whether the measured run completed", () => {
    const { observed_on: _drop, ...headroom } = provenHeadroom();
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EVIDENCE_MISSING,
        detail: PROVENANCE_MISSING_DETAIL,
      },
    ]);
  });

  it("refuses an unrecognised observed_on rather than reading it as pass", () => {
    const headroom = { ...provenHeadroom(), observed_on: "probably fine" };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EVIDENCE_MISSING,
        detail: PROVENANCE_MISSING_DETAIL,
      },
    ]);
  });

  it("requires provenance on a budgets[] entry too, which carries its own duration", () => {
    // A budgets[] entry publishes its own observed_worst_ms, so it can be a
    // starved figure exactly as the top-level one can.
    const headroom = {
      ...provenHeadroom(),
      budgets: [
        {
          subject: PROBE_SUBJECT,
          budget_ms: 60_000,
          observed_worst_ms: 23_600,
          measured_on_subject: PROBE_SUBJECT,
        },
      ],
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: EVIDENCE_MISSING,
        detail: PROVENANCE_MISSING_DETAIL,
      },
    ]);
  });

  it("reports provenance before the ratio, because a starved figure has no ratio", () => {
    // Both defects at once: a duration from a terminated run AND a thin margin
    // computed from it. The margin is not a fact about the budget — it is
    // arithmetic on a number that measures the wrong thing, so the provenance
    // is what the reader needs first.
    const headroom = {
      ...provenHeadroom(),
      observed_on: "fail",
      budget_ms: 10_000,
      observed_worst_ms: 9_200,
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: MEASURED_ON_FAILING_RUN,
        detail: MEASURED_ON_FAILING_RUN_DETAIL,
      },
    ]);
  });

  it("leaves a grandfathered block unprovenanced, since it proves nothing to begin with", () => {
    // Grandfathered entries are exempt from the evidence rules by design: their
    // obligation is to NAME what is unproven, not to prove it. Requiring
    // provenance of a measurement they never claim to have made would only
    // invite a fabricated field.
    expect(
      headroomProblems({ status: "grandfathered", debt: "never measured" })
    ).toEqual([]);
  });

  it("flags a budget sized from a different subject as sized-by-analogy", () => {
    // #2490 sized sonar-secrets' 60s budget from a 16-way probe run against
    // plugin-sync-scripts. Sizing from a sample that excludes the failure mode
    // is circular, and it is mechanically visible right here.
    const headroom = {
      ...provenHeadroom(),
      budgets: [
        {
          subject: "sonar-secrets",
          budget_ms: 60_000,
          observed_worst_ms: 10_000,
          measured_on_subject: PROBE_SUBJECT,
        },
      ],
    };
    expect(headroomProblems(headroom)).toEqual([
      {
        rule: "budget-sized-by-analogy",
        detail:
          "budget for 'sonar-secrets' was measured on 'plugin-sync-scripts'; a budget must be measured on the subject that consumes it",
      },
    ]);
  });

  it("accepts a budget measured on its own subject", () => {
    const headroom = {
      ...provenHeadroom(),
      budgets: [
        {
          subject: PROBE_SUBJECT,
          budget_ms: 60_000,
          observed_worst_ms: 23_600,
          observed_on: "pass",
          measured_on_subject: PROBE_SUBJECT,
        },
      ],
    };
    expect(headroomProblems(headroom)).toEqual([]);
  });

  it("refuses an unknown status rather than treating it as proven", () => {
    expect(headroomProblems({ status: "probably fine" })).toEqual([
      {
        rule: "unknown-headroom-status",
        detail:
          "headroom.status must be 'proven' or 'grandfathered', got 'probably fine'",
      },
    ]);
  });
});
