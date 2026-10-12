#!/usr/bin/env node
/**
 * The session manager's decision for one Blocked item: release it to Ready,
 * keep it, escalate it, or leave it to a human.
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
import { humanGateVerdict } from "../../../scripts/intake-blocker-reprobe.mjs";

/** Every action the plan may return. */
export const BLOCKED_RELEASE_ACTIONS = Object.freeze([
  "release",
  "keep",
  "escalate",
  "skip-human-gate",
]);

/**
 * Plan what to do with one Blocked item.
 *
 * Precedence, first match wins: a held human gate (`skip-human-gate`), a
 * pending manager question (`keep`), no edges (`keep`), every edge dissolves
 * (`release`), any edge escalates (`escalate`), otherwise `keep`.
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
 *   edges?: readonly object[] | null,
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
    return {
      action: "escalate",
      reason: `${resolution.escalations} of ${edges.length} blocker edge(s) need a human decision.`,
      edges: resolution.decisions,
      gate,
    };
  }

  return {
    action: "keep",
    reason:
      "at least one blocker has not shipped to the branch this item builds from.",
    edges: resolution.decisions,
    gate,
  };
}
