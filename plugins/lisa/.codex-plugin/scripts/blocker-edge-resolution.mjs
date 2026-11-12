#!/usr/bin/env node
/**
 * What to do with a dependency edge once its blocker has been judged.
 *
 * ## The gap this fills
 *
 * `blocker-containment` decides ONE question — given an edge, is it satisfied —
 * and says so in its own words: it "does not decide when a dependency edge
 * should exist, dissolve an edge once satisfied, or govern what a surface does
 * after clearing". Nothing else claimed that job. So a repair pass that ruled a
 * dependency satisfied moved the STATE and left the EDGE, recording the ruling
 * as a comment; the next reader parses relations, not prose, and blocks again
 * (CodySwannGT/lisa#3472). The durable artifact of "this is satisfied" had no
 * mechanical effect.
 *
 * Measured on this repository while writing this: of 11 open `status:blocked`
 * items carrying a parsable `Blocked by #N`, 5 were held behind blockers that
 * were all closed.
 *
 * ## Why closure is not the test, and neither is "it is finished"
 *
 * Two different mistakes converge on the same wrong answer.
 *
 * The first is testing a state NAME. That half is already fixed: the triage
 * gate now clear-checks by containment, because a promotion workflow types its
 * merged-and-deployed rungs `started`, so `Done` strands every dependent behind
 * work already merged where the dependent needs it.
 *
 * The second is treating CLOSED as satisfied. An `is blocked by` edge is a
 * DEVELOPMENT dependency: it is satisfied when the blocker's code is on the
 * branch this work builds from. A blocker can be closed with no code — and a
 * blocker closed `NOT_PLANNED` is the sharp case, because it means the thing
 * depended on will never be built. Dissolving that edge silently converts "what
 * we needed is cancelled" into "we are unblocked", which is the same wrong-write
 * family as CodySwannGT/lisa#3479, where a reason-blind repair would have
 * stamped a production terminal on abandoned work. So an abandoned blocker
 * ESCALATES to a human rather than dissolving or silently holding forever:
 * somebody has to decide whether the dependent still makes sense.
 *
 * ## What this module does not decide
 *
 * How an edge is dissolved on a given tracker. That is vendor work with its own
 * hazard: on Linear, `issueRelationCreate` CONVERTS an existing relation rather
 * than adding one (CodySwannGT/lisa#3605), so a writer that "updates" an edge
 * can destroy a different one. This module returns a decision; the vendor
 * surface performs it and reads it back.
 * @module blocker-edge-resolution
 */

/** Every action a surface may take on a judged edge. */
export const EDGE_ACTIONS = Object.freeze(["dissolve", "keep", "escalate"]);

/** GitHub's closure reason for work that will deliberately not be done. */
const NOT_PLANNED = "not_planned";

/**
 * Decide what happens to one `is blocked by` edge.
 *
 * `contained` is the containment verdict — the blocker's merged code is an
 * ancestor of the branch this work builds from — and it is deliberately the
 * ONLY positive signal. Everything else here exists to keep a non-containment
 * signal from being mistaken for one.
 * @param {{
 *   contained?: boolean | null,
 *   blockerState?: string,
 *   blockerReason?: string,
 * }} input The containment verdict and the blocker's tracker state.
 * @returns {{action: string, reason: string}} What to do, and why.
 */
export function resolveBlockerEdge(input = {}) {
  const state = String(input.blockerState ?? "")
    .trim()
    .toLowerCase();
  const reason = String(input.blockerReason ?? "")
    .trim()
    .toLowerCase();

  // Checked BEFORE containment, because an abandoned blocker whose branch
  // happens to contain some earlier commit of its own is still abandoned. The
  // question a human has to answer is whether the dependent still makes sense,
  // and a containment true would silently answer it for them.
  if (state === "closed" && reason === NOT_PLANNED) {
    return {
      action: "escalate",
      reason:
        "the blocker was closed as NOT PLANNED, so the work this item depends on will never be " +
        "delivered. Dissolving the edge would read as 'unblocked' when nothing was built, and " +
        "holding it forever hides a decision somebody has to make: does this item still make sense " +
        "without its blocker? That is a human call, not a sweep's.",
    };
  }

  if (input.contained === true) {
    return {
      action: "dissolve",
      reason:
        "the blocker's merged code is present on the branch this item builds from, so the " +
        "development dependency is satisfied. Remove the edge in the same write that records the " +
        "ruling, and read it back — a state move plus a comment is a claim about a clearance, not " +
        "a clearance, and the next reader parses relations rather than prose.",
    };
  }

  if (input.contained === null || input.contained === undefined) {
    return {
      action: "escalate",
      reason:
        "containment could not be computed for this blocker, so whether the dependency is satisfied " +
        "is unknown. An unknown is not a clearance: dissolving here would be a guess in the " +
        "direction that releases work, which is the direction nothing downstream re-checks.",
    };
  }

  return {
    action: "keep",
    reason:
      state === "closed"
        ? "the blocker is closed but its code is not on the branch this item builds from. Closing an " +
          "item is not the same as shipping it, and an `is blocked by` edge is a development " +
          "dependency, not a bookkeeping one."
        : "the blocker's code is not yet on the branch this item builds from, so the dependency " +
          "still holds.",
  };
}

/**
 * Decide a whole set of edges, and say whether the item can proceed.
 *
 * An item proceeds only when every edge dissolves. One escalation holds the
 * item — reporting it, rather than proceeding on the majority verdict, is what
 * keeps a single unanswerable edge from being rounded away.
 * @param {readonly object[]} edges Per-edge inputs, in the item's own order.
 * @returns {{
 *   proceed: boolean,
 *   decisions: {action: string, reason: string}[],
 *   escalations: number,
 * }} The per-edge decisions and whether the item is free to move.
 */
export function resolveBlockerEdges(edges = []) {
  const decisions = (edges ?? []).map(edge => ({
    ...edge,
    ...resolveBlockerEdge(edge),
  }));
  return {
    proceed:
      decisions.length > 0 && decisions.every(one => one.action === "dissolve"),
    decisions,
    escalations: decisions.filter(one => one.action === "escalate").length,
  };
}
