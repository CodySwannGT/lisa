/**
 * Which human-needed stops are planning misses (CodySwannGT/lisa#4569).
 *
 * A dispatched item that needs a human because something was missing,
 * unclear, contradictory or undecided means the PRD, the decomposition or the
 * ready gate let it through. `planningMissFor` is the one place that decides
 * which `--kind` counts, so the runbook can never quietly widen or narrow it:
 * a worker's question, an unflagged decision and an ambiguous repo route
 * count; an `exhausted` item, an environmental cause (outage, expired
 * credential, flaky tool) and a human gate planning flagged do not.
 * `planMark` carries the verdict, plus the candidate skeleton the manager
 * hands to `lisa-persist-learning`, without changing anything it wrote
 * before. Pure: no I/O.
 * @module tests/unit/session-manager/human-needed-planning-miss
 */
import { describe, expect, it } from "vitest";

import {
  HUMAN_NEEDED_KINDS,
  PLANNING_MISS_CAUSES,
  planMark,
  planningMissFor,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-needed.mjs";

const REF = "o/r#7";
const TEXT = "Which report format should the export produce, CSV or XLSX?";
const BASE = {
  ref: REF,
  text: TEXT,
  label: "human-needed",
  blocked: "Blocked",
};
const WORKER_QUESTION = "worker-question";
const HUMAN_GATE = "human-gate";

describe("planningMissFor", () => {
  it.each([
    [WORKER_QUESTION, "ready-gate"],
    ["decision", "prd"],
    ["repo-route", "decomposition"],
  ])("counts a %s as a planning miss, hinting the %s stage", (kind, stage) => {
    const verdict = planningMissFor({ kind });
    expect(verdict.counts).toBe(true);
    expect(verdict.stageHint).toBe(stage);
    expect(verdict.reason).not.toBe("");
  });

  it("never counts an exhausted item: repeated failed attempts are not a planning gap", () => {
    const verdict = planningMissFor({ kind: "exhausted" });
    expect(verdict.counts).toBe(false);
    expect(verdict.stageHint).toBeUndefined();
    expect(verdict.reason).toMatch(/attempts/);
  });

  it.each(HUMAN_NEEDED_KINDS)(
    "never counts a %s caused by an outage, expired credential or flaky tool",
    kind => {
      const verdict = planningMissFor({ kind, cause: "environment" });
      expect(verdict.counts).toBe(false);
      expect(verdict.stageHint).toBeUndefined();
    }
  );

  it.each(HUMAN_NEEDED_KINDS)(
    "never counts a %s that planning flagged as a human gate",
    kind => {
      const verdict = planningMissFor({ kind, cause: HUMAN_GATE });
      expect(verdict.counts).toBe(false);
      expect(verdict.reason).toMatch(/human gate/);
    }
  );

  it("defaults the cause to planning", () => {
    expect(PLANNING_MISS_CAUSES).toEqual([
      "planning",
      "environment",
      HUMAN_GATE,
    ]);
    expect(planningMissFor({ kind: "decision" })).toEqual(
      planningMissFor({ kind: "decision", cause: "planning" })
    );
  });

  it("refuses an unknown cause rather than guessing", () => {
    expect(() =>
      planningMissFor({ kind: WORKER_QUESTION, cause: "outage" })
    ).toThrow(/--cause must be one of: planning, environment, human-gate/);
  });
});

describe("planMark carries the planning-miss verdict", () => {
  it("adds a persist-learning candidate skeleton for a counting kind", () => {
    const plan = planMark({ ...BASE, kind: WORKER_QUESTION });
    expect(plan.planningMiss).toEqual({
      counts: true,
      stageHint: "ready-gate",
      reason: expect.any(String),
      candidate: {
        signal: "planning-miss",
        triggering_issue: REF,
        provenance: [REF],
        scope_hint: "project",
        kind: WORKER_QUESTION,
        missing: TEXT,
      },
    });
  });

  it("carries no candidate for an exhausted item or an excluded cause", () => {
    expect(
      planMark({ ...BASE, kind: "exhausted" }).planningMiss
    ).not.toHaveProperty("candidate");
    expect(
      planMark({ ...BASE, kind: "decision", cause: HUMAN_GATE }).planningMiss
    ).toMatchObject({ counts: false });
  });

  it("leaves the marker, move and comment exactly as before", () => {
    const plan = planMark({ ...BASE, kind: "exhausted" });
    expect(plan.marker).toEqual({ type: "label", value: "human-needed" });
    expect(plan.move).toEqual({ role: "blocked", value: "Blocked" });
    expect(plan.comment).toContain(TEXT);
    expect(plan.comment).not.toContain("planning");
  });
});
