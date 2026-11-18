/**
 * Turning what a run planned into the result it reports.
 *
 * The result is the answer to one question per enforcement point: are the
 * declared checks run at this moment, in this checkout? Each point carries
 * the `location` and `moment` the control register uses for the same point,
 * so a reader can line the two up, and one outcome:
 *
 * - `installed`: the call was not there and this run wrote it.
 * - `updated`: the call was there, and this run rewrote it or a file it
 *   starts.
 * - `already-wired`: nothing about the point changed.
 * - `blocked`: the checks do not run at this point, with the reason.
 * - `unenforceable`: only for a coding agent that has no hook that can
 *   refuse a file write. Nothing was installed, and the gap is recorded in
 *   the gates declaration. It is not a failure of the run.
 *
 * Under `--check` the outcomes say what a run would do; nothing was written.
 *
 * A run that was not asked to carry any coding agent reports exactly what it
 * always did: the sentences about agents, and the agent keys, appear only
 * when there is an agent point to report (`./carrier-agent-result.ts`).
 * @module controls/carrier-result
 */
import { describeAgentPoints } from "./carrier-agent-result.js";
import {
  ALREADY_WIRED,
  isAgentPlan,
  settledOutcome,
  type CarrierRunFacts,
} from "./carrier-outcome.js";
import {
  CARRIER_HOOKS,
  GIT_HOOK_LOCATION,
  STACK_HOOK,
  type CarrierOutcome,
  type CarrierPoint,
  type CarrierResult,
  type CarrierRunner,
  type KindPlan,
  type PointPlan,
} from "./carrier-types.js";

export type { CarrierRunFacts } from "./carrier-outcome.js";

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

/** The outcomes, worst first. */
const WORST_FIRST: readonly CarrierOutcome[] = [
  "blocked",
  "installed",
  "updated",
  ALREADY_WIRED,
];

/**
 * Report one planned git hook point.
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
  // A hook that already calls the runner needs nothing this command places,
  // so a refusal to place it does not block that point.
  const reason =
    point.through === STACK_HOOK
      ? point.blocked
      : (facts.stopped ?? point.blocked);
  return {
    hook: CARRIER_HOOKS[point.moment],
    kind: plan.kind,
    location: GIT_HOOK_LOCATION,
    moment: point.moment,
    outcome: reason === null ? settledOutcome(point, facts) : "blocked",
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
 * Say the outcome of a run that carries git hooks only, in one sentence.
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
 * Say the outcome of a run that also carries coding agents.
 *
 * Three parts, each said only when it has something to say: what the run
 * wrote, where git stands, and where the agents stand.
 * @param outcome - The run's outcome
 * @param gitPoints - The git hook points
 * @param agents - The sentence about the agent points
 * @param facts - What the run planned and did
 * @returns The sentences, joined
 */
function sentenceWithAgents(
  outcome: CarrierOutcome,
  gitPoints: readonly CarrierPoint[],
  agents: string,
  facts: CarrierRunFacts
): string {
  const count = facts.edits.length;
  const blocked = gitPoints.filter(point => point.outcome === "blocked");
  const wrote = (): string => {
    if (outcome === "blocked") return "";
    if (facts.check && count > 0) {
      return `Nothing was written. A run would make ${count} ${count === 1 ? "change" : "changes"}.`;
    }
    if (outcome === "installed") return "Installed.";
    return outcome === "updated"
      ? "Updated what was already installed."
      : "Nothing changed.";
  };
  const git =
    blocked.length > 0
      ? `Git does not run the declared checks at ${moments(blocked)} in this checkout. ${blocked[0]?.reason ?? ""}`
      : `Git runs the checks this repository declares at ${moments(gitPoints)}.`;
  return [wrote(), git, agents].filter(part => part !== "").join(" ");
}

/**
 * Work out the result of a run from its plan.
 * @param facts - What the run planned and did
 * @returns Everything in the result that depends on the plan
 */
export function describeCarrierRun(facts: CarrierRunFacts): DescribedRun {
  const gitPoints = facts.plans.flatMap(plan =>
    plan.points.flatMap(point =>
      isAgentPlan(point) ? [] : [reported(plan, point, facts)]
    )
  );
  const agents = describeAgentPoints(facts);
  const points = [...gitPoints, ...agents.points];
  // An unenforceable point is in neither list: it is recorded, not failed.
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
    reason:
      agents.points.length === 0
        ? sentence(outcome, points, facts)
        : sentenceWithAgents(outcome, gitPoints, agents.sentence, facts),
    runner: runnerReport(facts),
  };
}
