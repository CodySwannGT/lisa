/**
 * Lift holds that were never valid, with no person involved.
 *
 * Holds filed under the old "a human product call is pending" wording keep
 * stalling items, and the operator should never have to comment to release
 * one (CodySwannGT/lisa#4658, item 5). The intake and repair sweeps call
 * {@link planHumanGateLift} on every open item carrying a `[lisa-human-gate]`
 * hold. A hold whose reason names no act an agent cannot perform (see
 * `human-gate-act.mjs`) is lifted: the sweep posts a visible
 * `[lisa-human-gate-lifted] reason=<slug>` comment saying why, removes the
 * human-needed marker, and moves the item to the build-ready role.
 *
 * This is not a forged human release. A release records a person's answer; a
 * lift records that there was no question a person had to answer. A valid
 * hold — a credential, spend, a sign-off — is never lifted and still waits for
 * its act. A label-only hold (access blocked, a blocked verdict) has no
 * declared reason to judge and is never lifted either.
 * @module human-gate-lift
 */
import {
  HUMAN_GATE_LIFTED_MARKER,
  humanGateVerdict,
  invalidHumanGateHolds,
  planHumanGateRelease,
} from "./intake-blocker-reprobe.mjs";

/**
 * Render the lift comment for one invalid hold.
 *
 * The first line is the declaration the verdict reads; the rest is for a
 * non-technical operator, who is who reads this.
 * @param {{ reason?: unknown }} lift - The hold's reason key
 * @returns {string} Comment body
 */
export function formatHumanGateLift(lift = {}) {
  const reason = String(lift.reason ?? "").trim();
  const declaration =
    reason.length > 0
      ? `${HUMAN_GATE_LIFTED_MARKER} reason=${reason}`
      : HUMAN_GATE_LIFTED_MARKER;
  const named = reason.length > 0 ? `"${reason}"` : "this hold";
  return [
    declaration,
    `Hold lifted: ${named} is a decision an agent can make, not an act only a ` +
      "person can perform (a credential, spend, an external account, a legal " +
      "sign-off, or a system the agent cannot reach), so this item is back in " +
      "the build queue and whoever builds it decides and records the call; " +
      "the description is unchanged.",
  ].join("\n");
}

/**
 * Plan the lift for one item.
 *
 * Idempotent by state: a reason already lifted gets no second comment, and an
 * item already moved needs no label writes. Label actions are computed as if
 * the planned comments were already posted, by the same release planner the
 * human-release path uses, so the lane rules (never drag an item that has moved
 * on back to the queue) are shared rather than restated.
 * @param {{
 *   labels?: unknown
 *   body?: unknown
 *   comments?: unknown
 *   trustedHumanActorIds?: unknown
 *   humanNeededLabel?: unknown
 *   humanOnly?: unknown
 *   readyLabel?: unknown
 *   lifecycleLabels?: unknown
 * }} input - Candidate surfaces plus lane vocabulary and project policy
 * @returns {{ lift: boolean, reason: string, lifted: string[], kept: string[], comments: string[], actions: { removeHumanNeededLabel: boolean, addReadyLabel: string | null } }} Lift plan
 */
export function planHumanGateLift(input = {}) {
  const idle = Object.freeze({
    removeHumanNeededLabel: false,
    addReadyLabel: null,
  });
  const verdict = humanGateVerdict(input);
  const liftable = new Set(invalidHumanGateHolds(input.body, input.humanOnly));
  const toLift = verdict.outstanding.filter(reason => liftable.has(reason));
  const kept = verdict.outstanding.filter(reason => !toLift.includes(reason));
  const comments = toLift.map(reason => formatHumanGateLift({ reason }));

  // Nothing new to lift and something still held: an earlier partial lift is
  // history, not news, so a later cycle must not report the item again.
  if (toLift.length === 0 && (verdict.lifted.length === 0 || kept.length > 0)) {
    return {
      lift: false,
      reason: kept.length > 0 ? "hold-valid" : "nothing-to-lift",
      lifted: [],
      kept,
      comments: [],
      actions: idle,
    };
  }
  if (kept.length > 0) {
    return {
      lift: true,
      reason: "partial-lift",
      lifted: toLift,
      kept,
      comments,
      actions: idle,
    };
  }

  const prior = Array.isArray(input.comments) ? input.comments : [];
  const release = planHumanGateRelease({
    ...input,
    comments: [...prior, ...comments.map(body => ({ body }))],
    alreadyNotified: true,
  });
  const actions = {
    removeHumanNeededLabel: release.actions.removeHumanNeededLabel,
    addReadyLabel: release.actions.addReadyLabel,
  };
  const changed =
    comments.length > 0 ||
    actions.removeHumanNeededLabel ||
    actions.addReadyLabel !== null;
  return {
    lift: true,
    reason: changed ? "lift" : "already-lifted",
    lifted: toLift,
    kept: [],
    comments,
    actions,
  };
}

/**
 * Render the cycle-summary line naming what was lifted, printed even at zero.
 * @param {readonly unknown[]} lifted - Item references lifted this cycle
 * @returns {string} One summary line
 */
export function summarizeHumanGateLifts(lifted = []) {
  const names = (Array.isArray(lifted) ? lifted : [])
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(name => name.length > 0);
  if (names.length === 0) return "Invalid holds lifted: none.";
  return `Invalid holds lifted (${String(names.length)}): ${names.join(", ")}.`;
}
