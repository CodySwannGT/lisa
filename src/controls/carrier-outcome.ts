/**
 * What a run of `lisa controls install-carriers` planned and did, and the
 * outcome of one enforcement point whose call is in place.
 *
 * Held apart from the two modules that report a result (one for git hooks,
 * one for coding agents) so that both can use it without importing each
 * other.
 * @module controls/carrier-outcome
 */
import {
  STACK_HOOK,
  type AgentPointPlan,
  type CarrierEdit,
  type CarrierOutcome,
  type KindPlan,
  type PointPlan,
} from "./carrier-types.js";

/** What a run planned and did. */
export interface CarrierRunFacts {
  /** Whether nothing may be written. */
  readonly check: boolean;
  /** The plan of every kind of carrier. */
  readonly plans: readonly KindPlan[];
  /** Why nothing at all may be written, or `null`. */
  readonly stopped: string | null;
  /** Whether any point starts the runner this command places. */
  readonly runnerNeeded: boolean;
  /** The runner's files, from the repository root. */
  readonly runnerFiles: readonly string[];
  /** The carrier scripts the points start, from the repository root. */
  readonly scripts: readonly string[];
  /** Every write of the run, in order. */
  readonly edits: readonly CarrierEdit[];
}

/** The outcome of a point nothing changed for. */
export const ALREADY_WIRED: CarrierOutcome = "already-wired";

/**
 * Tell a coding agent's planned point from a git hook's.
 * @param point - A planned point
 * @returns Whether it belongs to a coding agent
 */
export function isAgentPlan(
  point: PointPlan | AgentPointPlan
): point is AgentPointPlan {
  return "agent" in point;
}

/**
 * The outcome of a point whose call is in place or will be.
 * @param point - The planned point
 * @param facts - What the run planned and did
 * @returns `installed`, `updated` or `already-wired`
 */
export function settledOutcome(
  point: PointPlan | AgentPointPlan,
  facts: CarrierRunFacts
): CarrierOutcome {
  const placed = new Set([...facts.runnerFiles, ...facts.scripts]);
  const placedChanged = facts.edits.some(edit => placed.has(edit.path));
  if (point.call === "added") return "installed";
  return point.call === "replaced" ||
    (placedChanged && point.through !== STACK_HOOK)
    ? "updated"
    : ALREADY_WIRED;
}
