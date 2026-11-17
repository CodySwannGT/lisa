/**
 * Turning what a run planned into the result it reports.
 *
 * The result is the answer to one question per enforcement point: does git
 * now run the declared checks at this moment, in this checkout? Each point
 * carries the `location` and `moment` the control register uses for the same
 * point, so a reader can line the two up, and one of four outcomes:
 *
 * - `installed`: the call was not there and this run wrote it.
 * - `updated`: the call was there, and this run rewrote it or a file it
 *   starts.
 * - `already-wired`: nothing about the point changed.
 * - `blocked`: git does not run the checks at this point, with the reason.
 *
 * Under `--check` the outcomes say what a run would do; nothing was written.
 * @module controls/carrier-result
 */
import {
  CARRIER_HOOKS,
  GIT_HOOK_LOCATION,
  STACK_HOOK,
  type CarrierEdit,
  type CarrierOutcome,
  type CarrierPoint,
  type CarrierResult,
  type CarrierRunner,
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

/** The part of the result that is worked out from the plan. */
export type DescribedRun = Pick<
  CarrierResult,
  | "mode"
  | "outcome"
  | "reason"
  | "hook_owner"
  | "enforcement_points"
  | "changes"
> & { readonly runner: Pick<CarrierRunner, "outcome" | "reason"> };

/** The outcome of a point nothing changed for. */
const ALREADY_WIRED: CarrierOutcome = "already-wired";

/** The outcomes, worst first. */
const WORST_FIRST: readonly CarrierOutcome[] = [
  "blocked",
  "installed",
  "updated",
  ALREADY_WIRED,
];

/**
 * Report one planned point.
 * @param plan - The plan the point belongs to
 * @param point - The planned point
 * @param facts - What the run planned and did
 * @returns The enforcement point as the result lists it
 */
function reported(
  plan: KindPlan,
  point: PointPlan,
  facts: CarrierRunFacts
): CarrierPoint {
  const placed = new Set([...facts.runnerFiles, ...facts.scripts]);
  const placedChanged = facts.edits.some(edit => placed.has(edit.path));
  const wired = point.through === STACK_HOOK;
  // A hook that already calls the runner needs nothing this command places,
  // so a refusal to place it does not block that point.
  const reason = wired ? point.blocked : (facts.stopped ?? point.blocked);
  const settled = (): CarrierOutcome => {
    if (point.call === "added") return "installed";
    return point.call === "replaced" || (placedChanged && !wired)
      ? "updated"
      : ALREADY_WIRED;
  };
  return {
    hook: CARRIER_HOOKS[point.moment],
    kind: plan.kind,
    location: GIT_HOOK_LOCATION,
    moment: point.moment,
    outcome: reason === null ? settled() : "blocked",
    path: point.path,
    reason,
    wired_through: point.through,
  };
}

/**
 * Report what became of the runner's files.
 * @param facts - What the run planned and did
 * @returns The outcome, and the reason when it is blocked
 */
function runnerReport(
  facts: CarrierRunFacts
): Pick<CarrierRunner, "outcome" | "reason"> {
  if (!facts.runnerNeeded) return { outcome: "not-needed", reason: null };
  if (facts.stopped !== null) {
    return { outcome: "blocked", reason: facts.stopped };
  }
  const files = new Set(facts.runnerFiles);
  const written = facts.edits.filter(edit => files.has(edit.path));
  const created = written.filter(edit => edit.action === "create");
  if (written.length === 0) return { outcome: ALREADY_WIRED, reason: null };
  return {
    outcome: created.length === files.size ? "installed" : "updated",
    reason: null,
  };
}

/**
 * Name the moments of some points in a sentence.
 * @param points - The points
 * @returns For example `commit and push`
 */
function moments(points: readonly CarrierPoint[]): string {
  return points.map(point => point.moment).join(" and ");
}

/**
 * Say the outcome of the run in one sentence.
 * @param outcome - The run's outcome
 * @param points - Every enforcement point
 * @param facts - What the run planned and did
 * @returns The sentence
 */
function sentence(
  outcome: CarrierOutcome,
  points: readonly CarrierPoint[],
  facts: CarrierRunFacts
): string {
  const blocked = points.filter(point => point.outcome === "blocked");
  const count = facts.edits.length;
  if (outcome === "blocked") {
    return `Git does not run the declared checks at ${moments(blocked)} in this checkout. ${blocked[0]?.reason ?? ""}`;
  }
  if (facts.check && count > 0) {
    return `Nothing was written. A run would make ${count} ${count === 1 ? "change" : "changes"} so that git runs the declared checks at ${moments(points)}.`;
  }
  if (outcome === "installed") {
    return `Installed. Git now runs the checks this repository declares at ${moments(points)}.`;
  }
  return outcome === "updated"
    ? `Updated what was already installed. Git runs the checks this repository declares at ${moments(points)}.`
    : `Nothing changed: git already runs the checks this repository declares at ${moments(points)}.`;
}

/**
 * Work out the result of a run from its plan.
 * @param facts - What the run planned and did
 * @returns Everything in the result that depends on the plan
 */
export function describeCarrierRun(facts: CarrierRunFacts): DescribedRun {
  const points = facts.plans.flatMap(plan =>
    plan.points.map(point => reported(plan, point, facts))
  );
  const worst = WORST_FIRST.find(candidate =>
    points.some(point => point.outcome === candidate)
  );
  const outcome =
    worst === ALREADY_WIRED && facts.edits.length > 0
      ? "updated"
      : (worst ?? ALREADY_WIRED);
  return {
    changes: facts.edits.map(({ action, path }) => ({ action, path })),
    enforcement_points: points,
    hook_owner: facts.plans[0]?.owner ?? "none",
    mode: facts.check ? "check" : "install",
    outcome,
    reason: sentence(outcome, points, facts),
    runner: runnerReport(facts),
  };
}
