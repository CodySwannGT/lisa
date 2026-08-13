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
      calledName: "🔎 AST Grep Scan",
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
        rule: "headroom-evidence-missing",
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
        rule: "headroom-evidence-missing",
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
