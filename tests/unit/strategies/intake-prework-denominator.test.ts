/**
 * Regression coverage for the build-intake pre-work denominator (#2657).
 *
 * Build-intake swept its candidate lanes by state NAME, so a `Blocked` lane —
 * which trackers model as a not-yet-started type, never as a distinct one —
 * fell out of the denominator entirely. Thirty-one consecutive cycles reported
 * a dry lane against a queue that was not dry, and every one of those records
 * was honest. The fix sweeps by TYPE and makes the denominator part of the
 * verdict.
 * @module tests/unit/strategies/intake-prework-denominator
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyPreWorkCandidate,
  formatReprobeNote,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  assertDenominatorReported,
  buildIntakeDenominator,
  formatIntakeDenominator,
  isPreWorkLaneType,
  requiresDenominator,
  selectPreWorkLanes,
  summarizeDryLane,
} from "../../../plugins/src/base/scripts/intake-prework-denominator.mjs";

const ANY_EVIDENCE = "any evidence at all";
const LOOP_ID = "intake-tickets";
const NOTHING_NEEDED = "nothing-needed";

const FIXTURE = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      "../../fixtures/intake-prework-denominator/linear-team-lanes.json"
    ),
    "utf8"
  )
) as {
  readonly totalOpen: number;
  readonly preFixSweptLaneNames: readonly string[];
  readonly lanes: readonly {
    name: string;
    type: string;
    position: number;
    count: number;
  }[];
};

/**
 * The pre-fix selection: a hardcoded roster of lane NAMES.
 *
 * @returns the row count that sweep saw
 */
function sweepByHardcodedNames(): number {
  const names = new Set(FIXTURE.preFixSweptLaneNames);
  return FIXTURE.lanes
    .filter(lane => names.has(lane.name))
    .reduce((total, lane) => total + lane.count, 0);
}

describe("pre-work lanes are swept by state type, not by state name (#2657)", () => {
  it("sweeps every not-yet-started lane including a Blocked lane typed unstarted", () => {
    expect(selectPreWorkLanes(FIXTURE.lanes).map(lane => lane.name)).toEqual([
      "Backlog",
      "Todo",
      "Ready",
      "Blocked",
    ]);
  });

  it("counts 61 more rows than the hardcoded-name sweep it replaces", () => {
    const denominator = buildIntakeDenominator({
      lanes: FIXTURE.lanes,
      totalOpen: FIXTURE.totalOpen,
    });

    expect(sweepByHardcodedNames()).toBe(39);
    expect(denominator.sweptCount).toBe(100);
    expect(denominator.totalOpen).toBe(343);
  });

  it("sweeps a custom pre-work lane no roster could have listed", () => {
    expect(
      selectPreWorkLanes([
        { name: "Icebox", type: "unstarted", position: 9, count: 4 },
        { name: "Shipping", type: "started", position: 1, count: 7 },
      ]).map(lane => lane.name)
    ).toEqual(["Icebox"]);
  });

  it("accepts a tracker that names lane types differently", () => {
    expect(isPreWorkLaneType("new")).toBe(true);
    expect(isPreWorkLaneType("To Do")).toBe(true);
    expect(isPreWorkLaneType("indeterminate")).toBe(false);
    expect(isPreWorkLaneType("done")).toBe(false);
    expect(isPreWorkLaneType("invented-by-nobody")).toBe(false);
  });

  it("keeps started and finished lanes out of the denominator", () => {
    const denominator = buildIntakeDenominator({
      lanes: FIXTURE.lanes,
      totalOpen: FIXTURE.totalOpen,
    });

    expect(denominator.omitted.map(lane => lane.name)).toEqual([
      "In Progress",
      "On Dev",
      "Done",
      "Canceled",
    ]);
    expect(denominator.unsweptCount).toBe(243);
  });
});

describe("a blocked item is re-probed rather than inherited (#2657)", () => {
  const blockedLeaf = {
    laneType: "unstarted",
    labels: ["repo:frontend", "type:Bug"],
    body: "Blocked until the shared package on trunk reaches 3.23.1.",
    statedBlocker: "shared package on trunk >= 3.23.1",
  };

  it("surfaces an item whose discharge condition went true, with the evidence", () => {
    expect(
      classifyPreWorkCandidate({
        ...blockedLeaf,
        probe: {
          discharged: true,
          evidence: "trunk manifest reads 3.27.0",
        },
      })
    ).toEqual({
      selectable: true,
      reason: "blocker-discharged",
      humanGated: false,
      evidence: "trunk manifest reads 3.27.0",
    });
  });

  it("leaves an item whose condition still holds, and records why", () => {
    const verdict = classifyPreWorkCandidate({
      ...blockedLeaf,
      probe: { discharged: false, evidence: "trunk manifest reads 3.21.0" },
    });

    expect(verdict.selectable).toBe(false);
    expect(verdict.reason).toBe("blocker-holds");
    expect(
      formatReprobeNote(
        { ...blockedLeaf, checkedAt: "2026-08-17T18:31:00.000Z" },
        verdict
      )
    ).toContain("The blocker was re-checked and still holds");
  });

  it("refuses to select on an unevidenced discharge", () => {
    expect(
      classifyPreWorkCandidate({ ...blockedLeaf, probe: { discharged: true } })
    ).toMatchObject({
      selectable: false,
      reason: "blocker-discharge-unevidenced",
    });
  });

  it("refuses to select an item nothing re-probed this cycle", () => {
    expect(
      classifyPreWorkCandidate({ ...blockedLeaf, probe: null })
    ).toMatchObject({ selectable: false, reason: "blocker-unprobed" });
  });

  it("selects a pre-work item that states no blocker at all", () => {
    expect(
      classifyPreWorkCandidate({ laneType: "unstarted", labels: [] })
    ).toMatchObject({ selectable: true, reason: "no-blocker" });
  });

  it("writes the re-probe note in plain words an operator can read", () => {
    const note = formatReprobeNote(
      {
        statedBlocker: "two advisories patched",
        checkedAt: "2026-08-17T00:00:00.000Z",
      },
      {
        reason: "blocker-discharged",
        evidence: "both advisories now carry a fix",
      }
    );

    expect(note).toContain("What has to be true: two advisories patched");
    expect(note).toContain(
      "no longer applies, so this item is buildable again"
    );
    expect(note).toContain("Proof: both advisories now carry a fix");
    expect(note).toContain("Checked at: 2026-08-17T00:00:00.000Z");
  });
});

describe("a human-gated item is never auto-selected (#2657)", () => {
  it("refuses an item carrying the human-needed label even when the blocker cleared", () => {
    expect(
      classifyPreWorkCandidate({
        laneType: "unstarted",
        labels: ["repo:frontend", "human-needed"],
        statedBlocker: "founder scope decision",
        probe: { discharged: true, evidence: ANY_EVIDENCE },
      })
    ).toMatchObject({
      selectable: false,
      reason: "human-gate",
      humanGated: true,
    });
  });

  it("refuses an item carrying the human-gate marker in its body", () => {
    expect(
      classifyPreWorkCandidate({
        laneType: "unstarted",
        labels: [],
        body: "<!-- [lisa-human-gate] reason=product-call -->",
        probe: { discharged: true, evidence: ANY_EVIDENCE },
      })
    ).toMatchObject({ selectable: false, humanGated: true });
  });

  it("honours a project-configured human-gate label name", () => {
    expect(
      classifyPreWorkCandidate({
        laneType: "unstarted",
        labels: ["Human Needed"],
        humanNeededLabel: "Human Needed",
        probe: { discharged: true, evidence: ANY_EVIDENCE },
      })
    ).toMatchObject({ selectable: false, humanGated: true });
  });
});

describe("a dry lane states its denominator (#2657)", () => {
  const denominator = buildIntakeDenominator({
    lanes: FIXTURE.lanes,
    totalOpen: FIXTURE.totalOpen,
  });

  it("names every swept lane, its count, and the open total", () => {
    const summary = summarizeDryLane(denominator, { queue: "team TUN" });

    expect(summary).toContain("Nothing ready to build on team TUN.");
    expect(summary).toContain("Backlog (20)");
    expect(summary).toContain("Todo (17)");
    expect(summary).toContain("Ready (2)");
    expect(summary).toContain("Blocked (61)");
    expect(summary).toContain("100 items checked out of 343 still open");
  });

  it("uses no jargon a non-technical operator would have to decode", () => {
    const summary = formatIntakeDenominator(denominator);

    for (const jargon of [
      "unstarted",
      "backlog type",
      "denominator",
      "GraphQL",
      "state type",
    ]) {
      expect(summary).not.toContain(jargon);
    }
  });

  it("requires a denominator only for a dry build-intake run", () => {
    expect(requiresDenominator(LOOP_ID, NOTHING_NEEDED)).toBe(true);
    expect(requiresDenominator(LOOP_ID, "candidate-proposed")).toBe(false);
    expect(requiresDenominator("monitor", NOTHING_NEEDED)).toBe(false);
  });

  it("rejects a dry build-intake run that states no denominator", () => {
    expect(() =>
      assertDenominatorReported({
        loopId: LOOP_ID,
        outcome: NOTHING_NEEDED,
      })
    ).toThrow(/must state the lanes it swept, and no denominator was supplied/);
  });

  it("rejects a denominator that names no lanes", () => {
    expect(() =>
      assertDenominatorReported({
        loopId: LOOP_ID,
        outcome: NOTHING_NEEDED,
        denominator: { swept: [], sweptCount: 0, totalOpen: 343 },
      })
    ).toThrow(/it names no swept lanes/);
  });

  it("rejects a denominator claiming more swept rows than are open", () => {
    expect(() =>
      assertDenominatorReported({
        loopId: LOOP_ID,
        outcome: NOTHING_NEEDED,
        denominator: {
          swept: [{ name: "Ready", type: "unstarted", count: 400 }],
          sweptCount: 400,
          totalOpen: 343,
        },
      })
    ).toThrow(/more items than are open/);
  });

  it("accepts a well-formed denominator", () => {
    expect(() =>
      assertDenominatorReported({
        loopId: LOOP_ID,
        outcome: NOTHING_NEEDED,
        denominator,
      })
    ).not.toThrow();
  });
});
