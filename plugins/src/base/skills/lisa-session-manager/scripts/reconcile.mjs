#!/usr/bin/env node
/**
 * The session manager's decision for one Blocked item: release it to Ready,
 * keep it, hand a decision to the agent, escalate it, or leave it to a human.
 *
 * ## Why this composes rather than decides
 *
 * Two shared modules already own the hard questions, and both exist because a
 * local re-implementation went wrong. `humanGateVerdict` is the only answer to
 * "is a person holding this?" — a label-only reader promoted held items
 * (#3805) — and it is the only place a hold ends, honouring only a release
 * from a trusted human actor. `resolveBlockerEdges` is the only answer to "is
 * this dependency satisfied?" — containment, never closure, and a NOT_PLANNED
 * blocker escalates instead of dissolving (#3472). This module imports both
 * and adds only the precedence between them, so the manager can never drift
 * from repair-intake's Class A ruling.
 *
 * ## Scope
 *
 * Only dependency blocks (Class A) and the manager's own pending questions.
 * An item blocked with no dependency edges is a gate self-block or a
 * clarification block (Class B/C); those belong to repair-intake and humans,
 * so this plan keeps them rather than guessing. The plan is pure: the caller
 * reads the item and computes containment, then performs the writes.
 * @module session-manager/reconcile
 */

import { resolveBlockerEdges } from "../../../scripts/blocker-edge-resolution.mjs";
import {
  humanGateVerdict,
  isStrictHumanGateMode,
} from "../../../scripts/intake-blocker-reprobe.mjs";

/** Every action the plan may return. */
export const BLOCKED_RELEASE_ACTIONS = Object.freeze([
  "release",
  "keep",
  "decide",
  "escalate",
  "skip-human-gate",
]);

/** `blockerReason` of a blocker closed as abandoned, as the edges carry it. */
const NOT_PLANNED = "not_planned";

/**
 * The plan for an item with at least one escalating edge.
 * @param {{decisions: {action: string, blockerReason?: unknown}[], escalations: number}} resolution
 *   The per-edge resolution
 * @param {number} total How many edges the item has
 * @param {{humanGateMode?: unknown}} input The plan input, for the mode
 * @returns {{action: string, reason: string, edges: object[]}} The plan
 */
function planEscalation(resolution, total, input) {
  const escalated = resolution.decisions.filter(
    one => one.action === "escalate"
  );
  const cancelled = escalated.filter(
    one =>
      String(one.blockerReason ?? "")
        .trim()
        .toLowerCase() === NOT_PLANNED
  ).length;
  const unknown = escalated.length - cancelled;
  const strict = isStrictHumanGateMode(input.humanGateMode);
  if (strict) {
    return {
      action: "escalate",
      reason: `${resolution.escalations} of ${total} blocker edge(s) need a human decision.`,
      edges: resolution.decisions,
    };
  }
  if (unknown > 0) {
    return {
      action: "escalate",
      reason:
        `containment could not be computed for ${unknown} of ${total} blocker edge(s); ` +
        "recompute it before judging this item.",
      edges: resolution.decisions,
    };
  }
  return {
    action: "decide",
    reason:
      `${cancelled} of ${total} blocker edge(s) were closed as NOT PLANNED. No person is ` +
      "needed: the agent that picks this item up decides whether to re-scope it, drop the " +
      "edge, or close the item, and records a `Decision:` line on the item saying which " +
      "and why.",
    edges: resolution.decisions,
  };
}

/**
 * Plan what to do with one Blocked item.
 *
 * Precedence, first match wins: a held human gate (`skip-human-gate`), a
 * pending manager question (`keep`), no edges (`keep`), every edge dissolves
 * (`release`), any edge escalates (`escalate`, or `decide` — see below),
 * otherwise `keep`.
 *
 * A blocker closed NOT PLANNED leaves a decision: does this item still make
 * sense without it? Under the default `humanGate.mode` (`access-only`) the
 * agent makes it (CodySwannGT/lisa#4687): the plan returns `decide`, telling
 * whoever picks the item up to re-scope it, drop the edge or close it, and to
 * record a `Decision:` line. Under `strict` it stays `escalate`, a human relay.
 * An edge whose containment could not be computed is never handed over as a
 * decision in either mode: an unknown is a measurement to redo, not a call.
 *
 * `edges` carries the per-edge decisions — each input edge plus its `action`
 * and `reason` — so the caller can quote them in the explanatory tracker
 * comment. It is empty when the edges were never judged.
 * @param {{
 *   labels?: unknown,
 *   body?: unknown,
 *   comments?: unknown,
 *   trustedHumanActorIds?: unknown,
 *   humanNeededLabel?: unknown,
 *   humanOnly?: unknown,
 *   humanGateMode?: unknown,
 *   edges?: readonly object[] | null | undefined,
 *   pendingQuestion?: unknown,
 * }} [input] The item's hold surfaces, its judged edges, and the ledger question.
 * @returns {{
 *   action: string,
 *   reason: string,
 *   edges: {action: string, reason: string}[],
 *   gate: ReturnType<typeof humanGateVerdict>,
 * }} The decision, why, and the evidence behind it.
 */
export function planBlockedRelease(input = {}) {
  const gate = humanGateVerdict({
    labels: input.labels,
    body: input.body,
    comments: input.comments,
    trustedHumanActorIds: input.trustedHumanActorIds,
    humanNeededLabel: input.humanNeededLabel,
    // The project's human-gate policy (CodySwannGT/lisa#4687): whether a hold
    // is valid, and so whether a lift comment may discharge it, depends on
    // `humanGate.mode` and `humanGate.humanOnly`. Omitted, a strict project's
    // hold would be judged under access-only. The caller resolves both from
    // config, never from the item.
    humanOnly: input.humanOnly,
    humanGateMode: input.humanGateMode,
  });

  if (gate.held) {
    return {
      action: "skip-human-gate",
      reason:
        "a person is holding this item and no trusted human has released it, so its edges are " +
        "not the manager's to judge.",
      edges: [],
      gate,
    };
  }

  if (input.pendingQuestion) {
    return {
      action: "keep",
      reason:
        "the manager is still waiting on an answer to its question about this item.",
      edges: [],
      gate,
    };
  }

  const edges = Array.isArray(input.edges) ? input.edges : [];
  if (edges.length === 0) {
    return {
      action: "keep",
      reason:
        "the item has no dependency edges, so it is a gate or clarification block; those are left " +
        "to repair-intake and humans.",
      edges: [],
      gate,
    };
  }

  const resolution = resolveBlockerEdges(edges);
  if (resolution.proceed) {
    return {
      action: "release",
      reason:
        "every blocker's code is on the branch this item builds from, so each edge dissolves.",
      edges: resolution.decisions,
      gate,
    };
  }

  if (resolution.escalations > 0) {
    return { ...planEscalation(resolution, edges.length, input), gate };
  }

  return {
    action: "keep",
    reason:
      "at least one blocker has not shipped to the branch this item builds from.",
    edges: resolution.decisions,
    gate,
  };
}
