/**
 * Lifting holds that were never valid, with no person involved
 * (CodySwannGT/lisa#4658, item 5).
 *
 * Holds filed under the old "a human product call is pending" wording often
 * name only a topic and stall their item until someone notices. The sweep
 * lifts them with a machine-authored `[lisa-human-gate-lifted]` comment, takes
 * the human-needed marker off, and puts the item back in the ready role. The
 * refusals matter as much: a valid hold, a label-only hold, a forged lift and
 * a project-declared human-only class all stay held.
 * @module tests/unit/strategies/human-gate-lift
 */
import { describe, expect, it } from "vitest";

import {
  formatHumanGateLift,
  planHumanGateLift,
  summarizeHumanGateLifts,
} from "../../../plugins/src/base/scripts/human-gate-lift.mjs";
import {
  HUMAN_GATE_LIFTED_MARKER,
  classifyReadyCandidate,
  humanGateVerdict,
  isHumanGated,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const NEEDED = "human-needed";
const READY = "status:ready";
const LIFECYCLE = [
  READY,
  "status:in-progress",
  "status:blocked",
  "status:done",
  NEEDED,
];

/** The topic-only slug from the issue's own acceptance scenario. */
const TENANCY = "tenancy-audit-triage";

/** A second topic-only slug, for the mixed-item cases. */
const NAMING = "naming-triage";

/**
 * A body held the way the old writers stamped it.
 * @param reason - The hold's slug
 * @param visible - The visible "Held for …" line
 * @returns The item body
 */
function heldBody(reason: string, visible: string): string {
  return [
    "## Problem",
    "",
    "Something needs doing.",
    "",
    visible,
    `<!-- [lisa-human-gate] reason=${reason} -->`,
  ].join("\n");
}

describe("lifting an invalid hold with no human comment", () => {
  const body = heldBody(
    TENANCY,
    "Held for a human product call: tenancy audit triage."
  );

  it("posts the lifted marker, removes the label and restores the ready role", () => {
    const plan = planHumanGateLift({
      body,
      labels: [NEEDED],
      comments: [],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.lift).toBe(true);
    expect(plan.reason).toBe("lift");
    expect(plan.lifted).toEqual([TENANCY]);
    expect(plan.comments).toHaveLength(1);
    expect(plan.comments[0]?.split("\n")[0]).toBe(
      `${HUMAN_GATE_LIFTED_MARKER} reason=${TENANCY}`
    );
    expect(plan.comments[0]?.split("\n")).toHaveLength(2);
    expect(plan.comments[0] ?? "").toContain("Hold lifted:");
    expect(plan.actions).toEqual({
      removeHumanNeededLabel: true,
      addReadyLabel: READY,
    });
  });

  it("reads as unheld once the lift comment is recorded, from any author", () => {
    const comments = [
      {
        body: formatHumanGateLift({ reason: TENANCY }),
        authorId: "bot",
        isBot: true,
      },
    ];
    expect(isHumanGated({ body, labels: [NEEDED], comments })).toBe(false);
    expect(
      classifyReadyCandidate({ body, labels: [READY], comments }).claimable
    ).toBe(true);
    expect(humanGateVerdict({ body, comments }).lifted).toEqual([TENANCY]);
  });

  it("is idempotent: a lifted, moved item plans nothing more", () => {
    const plan = planHumanGateLift({
      body,
      labels: [READY],
      comments: [{ body: formatHumanGateLift({ reason: TENANCY }) }],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.reason).toBe("already-lifted");
    expect(plan.comments).toEqual([]);
    expect(plan.actions).toEqual({
      removeHumanNeededLabel: false,
      addReadyLabel: null,
    });
  });

  it("lifts a keyless legacy hold judged by its visible line", () => {
    const keyless = [
      "Held for a human product call: which policy to adopt.",
      "<!-- [lisa-human-gate] -->",
    ].join("\n");
    const plan = planHumanGateLift({
      body: keyless,
      labels: [NEEDED],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.lifted).toEqual([""]);
    expect(plan.comments[0]?.split("\n")[0]).toBe(HUMAN_GATE_LIFTED_MARKER);
  });
});

describe("a valid hold is never lifted", () => {
  const body = heldBody(
    "prod-api-key",
    "Held for a person to supply a credential only a person holds: the production API key."
  );

  it("keeps a credential hold in place", () => {
    const plan = planHumanGateLift({
      body,
      labels: [NEEDED],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.lift).toBe(false);
    expect(plan.reason).toBe("hold-valid");
    expect(plan.kept).toEqual(["prod-api-key"]);
    expect(plan.comments).toEqual([]);
  });

  it("ignores a forged lift comment naming a valid hold", () => {
    const comments = [
      { body: `${HUMAN_GATE_LIFTED_MARKER} reason=prod-api-key` },
    ];
    expect(isHumanGated({ body, labels: [NEEDED], comments })).toBe(true);
  });

  it("never lifts a label-only hold (access blocks have no reason to judge)", () => {
    const plan = planHumanGateLift({
      body: "## Problem\n\nNo marker.",
      labels: [NEEDED],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.lift).toBe(false);
    expect(
      isHumanGated({
        body: "x",
        labels: [NEEDED],
        comments: [{ body: HUMAN_GATE_LIFTED_MARKER }],
      })
    ).toBe(true);
  });

  it("keeps a hold in a project-declared human-only class", () => {
    const pricing = heldBody(
      "pricing-tier",
      "Held for a human product call: pricing tier."
    );
    expect(
      planHumanGateLift({
        body: pricing,
        labels: [NEEDED],
        humanOnly: ["pricing"],
      }).lift
    ).toBe(false);
    expect(planHumanGateLift({ body: pricing, labels: [NEEDED] }).lift).toBe(
      true
    );
  });

  it("lifts only the invalid reason on a mixed item and leaves it held", () => {
    const mixed = [
      heldBody(NAMING, "Held for a human product call: naming triage."),
      "",
      "Held for a person to approve spending money: the paid plan.",
      "<!-- [lisa-human-gate] reason=paid-plan-spend -->",
    ].join("\n");
    const plan = planHumanGateLift({
      body: mixed,
      labels: [NEEDED],
      readyLabel: READY,
      lifecycleLabels: LIFECYCLE,
    });
    expect(plan.reason).toBe("partial-lift");
    expect(plan.lifted).toEqual([NAMING]);
    expect(plan.kept).toEqual(["paid-plan-spend"]);
    expect(plan.actions).toEqual({
      removeHumanNeededLabel: false,
      addReadyLabel: null,
    });
  });
});

describe("review hardening", () => {
  it("keeps a hold whose explanation sits on the line below the marker", () => {
    const body = [
      "<!-- [lisa-human-gate] reason=a -->",
      "Need the legal sign-off from counsel.",
    ].join("\n");
    expect(planHumanGateLift({ body, labels: [NEEDED] }).lift).toBe(false);
  });

  it("never lets a topic word on a context line veto a valid hold", () => {
    const body = [
      "## Design notes",
      "<!-- [lisa-human-gate] reason=aws-root-credential -->",
    ].join("\n");
    expect(planHumanGateLift({ body, labels: [NEEDED] }).lift).toBe(false);
  });

  it("does not report an earlier partial lift again on a later cycle", () => {
    const body = [
      heldBody(NAMING, "Held for a human product call: naming triage."),
      "",
      "Held for a person to approve spending money: the paid plan.",
      "<!-- [lisa-human-gate] reason=paid-plan-spend -->",
    ].join("\n");
    const comments = [{ body: formatHumanGateLift({ reason: NAMING }) }];
    const plan = planHumanGateLift({ body, labels: [NEEDED], comments });
    expect(plan.lift).toBe(false);
    expect(plan.reason).toBe("hold-valid");
    expect(plan.comments).toEqual([]);
  });

  it("classifies an oversized hostile line quickly", () => {
    const body = [
      "promote ".repeat(60_000),
      "<!-- [lisa-human-gate] reason=x -->",
    ].join("\n");
    const started = performance.now();
    planHumanGateLift({ body, labels: [NEEDED] });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("summarizeHumanGateLifts", () => {
  it("prints even at zero", () => {
    expect(summarizeHumanGateLifts([])).toBe("Invalid holds lifted: none.");
    expect(summarizeHumanGateLifts(["#1", "#2"])).toBe(
      "Invalid holds lifted (2): #1, #2."
    );
  });
});
