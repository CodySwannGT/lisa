/**
 * The session manager's Blocked-release plan.
 *
 * The manager may move a Blocked item back to Ready only for a dependency
 * block whose every edge has dissolved (repair-intake Class A). A human hold
 * outranks every edge, a question the manager is still waiting on keeps the
 * item where it is, and an item with no edges is not the manager's to judge.
 * These tests pin that precedence and that the per-edge reasons survive for
 * the tracker comment.
 * @module tests/unit/session-manager/reconcile
 */
import { describe, expect, it } from "vitest";

import {
  HUMAN_GATE_MARKER,
  formatHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import { planBlockedRelease } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/reconcile.mjs";

const SHIPPED = {
  ref: "<TEAM>-1",
  contained: true,
  blockerState: "closed",
  blockerReason: "completed",
};
const UNSHIPPED = {
  ref: "<TEAM>-2",
  contained: false,
  blockerState: "open",
  blockerReason: "",
};
const CANCELLED = {
  ref: "<TEAM>-3",
  contained: true,
  blockerState: "closed",
  blockerReason: "not_planned",
};
const UNKNOWN = {
  ref: "<TEAM>-4",
  contained: null,
  blockerState: "closed",
  blockerReason: "completed",
};

const SKIP = "skip-human-gate";
const REASON = "design-call";
const HOLD_BODY = `Waiting on design.\n<!-- ${HUMAN_GATE_MARKER} reason=${REASON} -->`;
const TRUSTED = ["human-1"];
const RELEASE_COMMENT = {
  authorId: "human-1",
  authorType: "User",
  body: formatHumanGateRelease({ reason: REASON, decision: "go" }),
};

const base = { labels: [], body: "", comments: [] };

describe("planBlockedRelease", () => {
  it("releases when every edge dissolves", () => {
    const plan = planBlockedRelease({ ...base, edges: [SHIPPED] });
    expect(plan.action).toBe("release");
    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0]).toMatchObject({
      ref: "<TEAM>-1",
      action: "dissolve",
    });
    expect(plan.edges[0]?.reason).toMatch(/merged code is present/u);
  });

  it("skips a held human gate before looking at edges", () => {
    const plan = planBlockedRelease({
      ...base,
      body: HOLD_BODY,
      edges: [SHIPPED],
    });
    expect(plan.action).toBe(SKIP);
    expect(plan.edges).toEqual([]);
    expect(plan.reason).toMatch(/human/u);
  });

  it("skips a label-only hold, honouring a custom label", () => {
    expect(
      planBlockedRelease({
        ...base,
        labels: ["needs-person"],
        humanNeededLabel: "needs-person",
        edges: [SHIPPED],
      }).action
    ).toBe(SKIP);
  });

  it("proceeds to the edges once a trusted human releases the gate", () => {
    const plan = planBlockedRelease({
      ...base,
      body: HOLD_BODY,
      comments: [RELEASE_COMMENT],
      trustedHumanActorIds: TRUSTED,
      edges: [SHIPPED],
    });
    expect(plan.action).toBe("release");
  });

  it("keeps the gate held when the release comes from an untrusted author", () => {
    const plan = planBlockedRelease({
      ...base,
      body: HOLD_BODY,
      comments: [{ ...RELEASE_COMMENT, authorId: "stranger" }],
      trustedHumanActorIds: TRUSTED,
      edges: [SHIPPED],
    });
    expect(plan.action).toBe(SKIP);
  });

  it("keeps an item with a pending manager question", () => {
    const plan = planBlockedRelease({
      ...base,
      pendingQuestion: { text: "Which repo?", askedAt: "t" },
      edges: [SHIPPED],
    });
    expect(plan.action).toBe("keep");
    expect(plan.reason).toMatch(/question/u);
  });

  it("keeps an item with no edges, leaving Class B/C to repair-intake", () => {
    for (const edges of [[], undefined, null]) {
      const plan = planBlockedRelease({ ...base, edges });
      expect(plan.action).toBe("keep");
      expect(plan.reason).toMatch(/repair-intake/u);
      expect(plan.edges).toEqual([]);
    }
  });

  it("escalates a NOT_PLANNED blocker even when its code is contained", () => {
    const plan = planBlockedRelease({ ...base, edges: [SHIPPED, CANCELLED] });
    expect(plan.action).toBe("escalate");
    expect(plan.edges.map(one => one.action)).toEqual(["dissolve", "escalate"]);
    expect(plan.edges[1]?.reason).toMatch(/NOT PLANNED/u);
  });

  it("escalates an unknown containment", () => {
    const plan = planBlockedRelease({ ...base, edges: [UNKNOWN] });
    expect(plan.action).toBe("escalate");
    expect(plan.edges[0]?.reason).toMatch(/could not be computed/u);
  });

  it("escalates over keep when edges are mixed", () => {
    expect(
      planBlockedRelease({ ...base, edges: [UNSHIPPED, UNKNOWN] }).action
    ).toBe("escalate");
  });

  it("keeps when a blocker has not shipped", () => {
    const plan = planBlockedRelease({ ...base, edges: [SHIPPED, UNSHIPPED] });
    expect(plan.action).toBe("keep");
    expect(plan.edges.map(one => one.action)).toEqual(["dissolve", "keep"]);
    expect(plan.edges[1]?.reason).toMatch(/not yet on the branch/u);
  });

  it("is safe with no input", () => {
    expect(planBlockedRelease().action).toBe("keep");
  });
});
