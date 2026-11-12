#!/usr/bin/env node
/**
 * Pre-work denominator for build-queue intake scanners.
 *
 * A build-intake cycle that reports an empty lane is only as trustworthy as the
 * set of lanes it swept. Sweeping by lane NAME (`Backlog`, `Todo`, `Ready`)
 * omits every pre-work lane a team invented — most commonly a `Blocked` lane,
 * which is not a distinct Linear state type at all: teams model it as
 * `unstarted`, i.e. work that was never started. Items parked there carry a
 * written blocker that nothing ever re-reads, so the lane reads as terminal
 * while it is in fact a queue.
 *
 * This module fixes both halves: lanes are selected by TYPE, never by name, and
 * the swept set is reported alongside the total so a wrong denominator is
 * visible on inspection instead of silent forever.
 */

/** Lane types that hold work which has not started. Both belong to intake. */
export const PRE_WORK_LANE_TYPES = Object.freeze(["backlog", "unstarted"]);

/** Loop ids whose `nothing-needed` runs must state their denominator. */
export const DENOMINATOR_REQUIRED_LOOP_IDS = Object.freeze(["intake-tickets"]);

/**
 * Vendor lane-type vocabularies normalized onto Linear's five-value type set.
 * JIRA exposes the same idea as `statusCategory` (key or display name); GitHub
 * has no type field at all, so its callers pass a type explicitly.
 */
const LANE_TYPE_ALIASES = Object.freeze({
  backlog: "backlog",
  unstarted: "unstarted",
  started: "started",
  completed: "completed",
  canceled: "canceled",
  cancelled: "canceled",
  new: "unstarted",
  indeterminate: "started",
  done: "completed",
  "to do": "unstarted",
  "in progress": "started",
});

/**
 * Map a vendor lane type onto the normalized vocabulary.
 *
 * @param {unknown} type
 * @returns {string | null} normalized type, or null when unrecognized
 */
export function normalizeLaneType(type) {
  if (typeof type !== "string") {
    return null;
  }
  return LANE_TYPE_ALIASES[type.trim().toLowerCase()] ?? null;
}

/**
 * @param {unknown} type
 * @returns {boolean} whether this lane holds not-yet-started work
 */
export function isPreWorkLaneType(type) {
  const normalized = normalizeLaneType(type);
  return normalized !== null && PRE_WORK_LANE_TYPES.includes(normalized);
}

/**
 * @param {unknown} lane
 * @returns {{ name: string, type: string | null, count: number, position: number } | null}
 */
function normalizeLane(lane) {
  if (!lane || typeof lane !== "object") {
    return null;
  }
  const name = String(lane.name ?? "").trim();
  if (name.length === 0) {
    return null;
  }
  const rawCount = Number(lane.count ?? 0);
  const rawPosition = Number(lane.position ?? Number.POSITIVE_INFINITY);

  return {
    name,
    type: normalizeLaneType(lane.type ?? lane.statusCategory),
    count: Number.isFinite(rawCount) && rawCount > 0 ? Math.trunc(rawCount) : 0,
    position: Number.isFinite(rawPosition)
      ? rawPosition
      : Number.POSITIVE_INFINITY,
  };
}

/**
 * @param {{ position: number, name: string }} left
 * @param {{ position: number, name: string }} right
 * @returns {number}
 */
function compareLanes(left, right) {
  if (left.position !== right.position) {
    return left.position - right.position;
  }
  return left.name.localeCompare(right.name);
}

/**
 * Select every lane holding not-yet-started work, by type.
 *
 * Deliberately name-blind: a team that adds `Blocked`, `Triaged`, or `Icebox`
 * as an `unstarted` state gets it swept without a code change, and no hardcoded
 * roster can fall behind the board.
 *
 * @param {readonly unknown[]} lanes
 * @returns {readonly {name: string, type: string, count: number, position: number}[]}
 */
export function selectPreWorkLanes(lanes) {
  return (Array.isArray(lanes) ? lanes : [])
    .map(normalizeLane)
    .filter(lane => lane !== null && isPreWorkLaneType(lane.type))
    .sort(compareLanes);
}

/**
 * Build the denominator a scanner must report with its verdict.
 *
 * `totalOpen` is the count of open items on the queue, independent of lanes —
 * supplying it is what makes an omitted lane arithmetically visible.
 *
 * @param {{ lanes?: readonly unknown[], totalOpen?: number }} input
 * @returns {{
 *   swept: readonly {name: string, type: string, count: number}[]
 *   omitted: readonly {name: string, type: string | null, count: number}[]
 *   sweptCount: number
 *   totalOpen: number
 *   unsweptCount: number
 * }}
 */
export function buildIntakeDenominator(input = {}) {
  const normalized = (Array.isArray(input.lanes) ? input.lanes : [])
    .map(normalizeLane)
    .filter(lane => lane !== null)
    .sort(compareLanes);
  const swept = normalized.filter(lane => isPreWorkLaneType(lane.type));
  const omitted = normalized.filter(lane => !isPreWorkLaneType(lane.type));
  const sweptCount = swept.reduce((total, lane) => total + lane.count, 0);
  const laneTotal = normalized.reduce((total, lane) => total + lane.count, 0);
  const rawTotalOpen = Number(input.totalOpen);
  const totalOpen =
    Number.isFinite(rawTotalOpen) && rawTotalOpen >= 0
      ? Math.trunc(rawTotalOpen)
      : laneTotal;

  return {
    swept: swept.map(({ name, type, count }) => ({ name, type, count })),
    omitted: omitted.map(({ name, type, count }) => ({ name, type, count })),
    sweptCount,
    totalOpen,
    unsweptCount: Math.max(totalOpen - sweptCount, 0),
  };
}

/**
 * Render the denominator for a non-technical operator.
 *
 * @param {ReturnType<typeof buildIntakeDenominator>} denominator
 * @returns {string}
 */
export function formatIntakeDenominator(denominator) {
  const lanes = denominator?.swept ?? [];
  const listed =
    lanes.length > 0
      ? lanes.map(lane => `${lane.name} (${lane.count})`).join(", ")
      : "no pre-work lanes found";

  return `Looked in every lane holding work that has not started — ${listed} — ${denominator.sweptCount} items checked out of ${denominator.totalOpen} still open.`;
}

/**
 * Render the full operator-readable one-liner for a dry build lane.
 *
 * @param {ReturnType<typeof buildIntakeDenominator>} denominator
 * @param {{ queue?: string }} [context]
 * @returns {string}
 */
export function summarizeDryLane(denominator, context = {}) {
  const queue =
    typeof context.queue === "string" && context.queue.trim().length > 0
      ? ` on ${context.queue.trim()}`
      : "";

  return `Nothing ready to build${queue}. ${formatIntakeDenominator(denominator)}`;
}

/**
 * @param {unknown} loopId
 * @param {unknown} outcome
 * @returns {boolean} whether this run must carry a denominator
 */
export function requiresDenominator(loopId, outcome) {
  return (
    outcome === "nothing-needed" &&
    DENOMINATOR_REQUIRED_LOOP_IDS.includes(String(loopId ?? "").trim())
  );
}

/**
 * @param {unknown} denominator
 * @returns {string | null} the reason it is unusable, or null when valid
 */
function findDenominatorDefect(denominator) {
  if (!denominator || typeof denominator !== "object") {
    return "no denominator was supplied";
  }
  if (!Array.isArray(denominator.swept) || denominator.swept.length === 0) {
    return "it names no swept lanes";
  }
  if (!Number.isInteger(denominator.sweptCount)) {
    return "its swept count is not a whole number";
  }
  if (!Number.isInteger(denominator.totalOpen)) {
    return "its open-item total is not a whole number";
  }
  if (denominator.sweptCount > denominator.totalOpen) {
    return "it claims to have swept more items than are open";
  }
  return null;
}

/**
 * Refuse to record a dry build lane that does not say what it looked at.
 *
 * Thirty-one consecutive cycles reported an empty lane against a queue holding
 * unswept pre-work rows. Every record was honest and every conclusion was
 * false, because none of them stated a denominator. This turns that silent
 * wrong answer into a loud one.
 *
 * @param {{ loopId?: unknown, outcome?: unknown, denominator?: unknown }} input
 * @throws {Error} when a denominator is required and missing or malformed
 */
export function assertDenominatorReported(input = {}) {
  if (!requiresDenominator(input.loopId, input.outcome)) {
    return;
  }
  const defect = findDenominatorDefect(input.denominator);
  if (defect === null) {
    return;
  }

  throw new Error(
    `A "nothing-needed" run for loop "${String(input.loopId).trim()}" must state the lanes it swept, and ${defect}. ` +
      `Pass a denominator built by buildIntakeDenominator() so an omitted lane is visible instead of silent.`
  );
}
