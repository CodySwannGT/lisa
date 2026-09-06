/**
 * What happens to a dependency edge once its blocker is judged (#3472).
 *
 * `blocker-containment` answers "is this edge satisfied" and explicitly
 * disclaims the rest: it "does not decide when a dependency edge should exist,
 * dissolve an edge once satisfied, or govern what a surface does after
 * clearing". Nothing else claimed that job, so a repair pass moved the STATE,
 * left the EDGE, and recorded the ruling as a comment — which the next reader
 * does not parse, because it reads relations. The block re-formed on the next
 * cycle.
 *
 * ## The case these exist to stop
 *
 * The tempting shortcut is "the blocker is closed, so dissolve". A blocker
 * closed NOT_PLANNED is work that will never be delivered, and dissolving that
 * edge converts "what we needed is cancelled" into "we are unblocked" — the
 * same reason-blind wrong write as #3479. So the abandoned case must escalate,
 * and asserting it is the point of this suite rather than a corner of it.
 * @module tests/unit/strategies/blocker-edge-resolution
 */
import { describe, expect, it } from "vitest";

import {
  EDGE_ACTIONS,
  resolveBlockerEdge,
  resolveBlockerEdges,
} from "../../../plugins/src/base/scripts/blocker-edge-resolution.mjs";

const DISSOLVE = "dissolve";
const KEEP = "keep";
const ESCALATE = "escalate";
const CLOSED = "closed";

describe("containment is the only thing that dissolves an edge", () => {
  it("dissolves when the blocker's code is on the branch", () => {
    const decision = resolveBlockerEdge({
      contained: true,
      blockerState: CLOSED,
    });

    expect(decision.action).toBe(DISSOLVE);
    // The ruling has to be the same write as the removal, or it is a claim.
    expect(decision.reason).toContain("read it back");
  });

  it("dissolves even while the blocker sits at an intermediate env rung", () => {
    // The half already fixed upstream, pinned here so it cannot regress: a
    // promotion workflow types its merged-and-deployed rungs `started`, so a
    // predicate keyed to a terminal name strands every dependent.
    expect(
      resolveBlockerEdge({ contained: true, blockerState: "started" }).action
    ).toBe(DISSOLVE);
  });

  it("keeps the edge when the blocker is closed but its code is not on the branch", () => {
    // Closing an item is not shipping it. This is the shortcut the suite
    // exists to refuse.
    const decision = resolveBlockerEdge({
      contained: false,
      blockerState: CLOSED,
      blockerReason: "completed",
    });

    expect(decision.action).toBe(KEEP);
    expect(decision.reason).toContain("not the same as shipping");
  });

  it("keeps the edge while the blocker is still open", () => {
    expect(
      resolveBlockerEdge({ contained: false, blockerState: "open" }).action
    ).toBe(KEEP);
  });
});

describe("an abandoned blocker is a human's decision, not a sweep's", () => {
  it("escalates a NOT_PLANNED blocker rather than dissolving", () => {
    const decision = resolveBlockerEdge({
      contained: false,
      blockerState: CLOSED,
      blockerReason: "NOT_PLANNED",
    });

    expect(decision.action).toBe(ESCALATE);
    expect(decision.reason).toContain("never be delivered");
  });

  it("escalates a NOT_PLANNED blocker even when containment reads true", () => {
    // Checked before containment on purpose. An abandoned blocker whose branch
    // happens to contain some earlier commit of its own is still abandoned, and
    // a containment true would answer the human's question for them.
    expect(
      resolveBlockerEdge({
        contained: true,
        blockerState: CLOSED,
        blockerReason: "NOT_PLANNED",
      }).action
    ).toBe(ESCALATE);
  });

  it("does not escalate an ordinary completed closure", () => {
    // The control. A rule that escalated every closure would satisfy the cases
    // above and stall every queue.
    expect(
      resolveBlockerEdge({
        contained: true,
        blockerState: CLOSED,
        blockerReason: "COMPLETED",
      }).action
    ).toBe(DISSOLVE);
  });
});

describe("an unknown is not a clearance", () => {
  it("escalates when containment could not be computed", () => {
    const decision = resolveBlockerEdge({ contained: null });

    expect(decision.action).toBe(ESCALATE);
    expect(decision.reason).toContain("not a clearance");
  });

  it("escalates when containment was never supplied", () => {
    expect(resolveBlockerEdge({}).action).toBe(ESCALATE);
  });
});

describe("an item proceeds only when every edge dissolves", () => {
  it("proceeds when all edges are contained", () => {
    const result = resolveBlockerEdges([
      { contained: true },
      { contained: true },
    ]);

    expect(result.proceed).toBe(true);
    expect(result.escalations).toBe(0);
  });

  it("holds the item on a single escalation among dissolves", () => {
    // Rounding one unanswerable edge away is how a block silently stops being
    // a block.
    const result = resolveBlockerEdges([
      { contained: true },
      { blockerState: CLOSED, blockerReason: "NOT_PLANNED" },
    ]);

    expect(result.proceed).toBe(false);
    expect(result.escalations).toBe(1);
  });

  it("does not proceed on an item with no edges at all", () => {
    // Nothing to dissolve is not the same as a cleared dependency; a caller
    // asking about an item with no edges must not read `true` as a clearance.
    expect(resolveBlockerEdges([]).proceed).toBe(false);
  });

  it("returns one decision per edge, in the item's own order", () => {
    const result = resolveBlockerEdges([
      { contained: false },
      { contained: true },
    ]);

    expect(result.decisions.map(one => one.action)).toEqual([KEEP, DISSOLVE]);
  });

  it("declares exactly the actions a surface must handle", () => {
    expect([...EDGE_ACTIONS]).toEqual([DISSOLVE, KEEP, ESCALATE]);
  });
});
