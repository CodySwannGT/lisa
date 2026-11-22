/**
 * Reporting the enforcement points of coding agents.
 *
 * An agent point carries what a git hook point does, the same `location` and
 * `moment` the control register uses, and three things of its own: the agent
 * it belongs to, the agent's name for its hook, and how the agent is told a
 * write failed together with how well that is known. A reader who needs to
 * decide how far to trust an agent's edit-time enforcement reads
 * `refusal_evidence`.
 *
 * An agent with no hook is reported `unenforceable`, with the reason and the
 * gates whose declaration now names it.
 * @module controls/carrier-agent-result
 */
import {
  isAgentPlan,
  settledOutcome,
  type CarrierRunFacts,
} from "./carrier-outcome.js";
import {
  AGENT_HOOK_LOCATION,
  NO_HOOK_SURFACE,
  type AgentPointPlan,
  type CarrierKind,
  type CarrierPoint,
} from "./carrier-types.js";
import { EDIT_TIME_MOMENT } from "./coding-agents.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";

/** The agent points of a result, and what to say about them. */
export interface DescribedAgents {
  /** One point per agent, in roster order; empty when none was asked for. */
  readonly points: readonly CarrierPoint[];
  /** One sentence about them; empty when there is none. */
  readonly sentence: string;
}

/**
 * Say where an agent's gap is written down.
 * @param point - The planned point of an agent with no hook
 * @returns The sentence that follows the reason
 */
function recordedNote(point: AgentPointPlan): string {
  const gates = point.unenforceable?.recordedOn ?? [];
  return gates.length === 0
    ? `Nothing is declared at ${EDIT_TIME_MOMENT} in ${GATES_DECLARATION_PATH} yet, so there is nothing to record it on. Run this again after declaring a check there.`
    : `${GATES_DECLARATION_PATH} records it on ${gates.length === 1 ? "the gate" : "the gates"} ${gates.join(", ")}, so the control register names the agent at ${EDIT_TIME_MOMENT}.`;
}

/**
 * Report the point of an agent with no hook.
 * @param kind - The kind of carrier
 * @param point - The planned point
 * @param facts - What the run planned and did
 * @returns The enforcement point as the result lists it
 */
function reportedGap(
  kind: CarrierKind,
  point: AgentPointPlan,
  facts: CarrierRunFacts
): CarrierPoint {
  // Recording the gap is one of the run's writes. When the run may write
  // nothing at all, a record that is not there yet stays missing.
  const blocked =
    point.blocked ?? (point.call === "added" ? facts.stopped : null);
  return {
    agent: point.agent,
    hook: null,
    kind,
    location: AGENT_HOOK_LOCATION,
    moment: point.moment,
    outcome: blocked === null ? "unenforceable" : "blocked",
    path: point.path,
    reason:
      blocked ?? `${point.unenforceable?.reason ?? ""} ${recordedNote(point)}`,
    recorded_on: [...(point.unenforceable?.recordedOn ?? [])],
    wired_through: point.through,
  };
}

/**
 * Report the point of an agent that has a hook.
 * @param kind - The kind of carrier
 * @param point - The planned point
 * @param facts - What the run planned and did
 * @returns The enforcement point as the result lists it
 */
function reportedHook(
  kind: CarrierKind,
  point: AgentPointPlan,
  facts: CarrierRunFacts
): CarrierPoint {
  const reason = facts.stopped ?? point.blocked;
  return {
    agent: point.agent,
    hook: point.hook,
    kind,
    location: AGENT_HOOK_LOCATION,
    moment: point.moment,
    outcome: reason === null ? settledOutcome(point, facts) : "blocked",
    path: point.path,
    reason,
    ...(point.refusal === undefined
      ? {}
      : {
          refusal: point.refusal.signal,
          refusal_evidence: point.refusal.evidence,
        }),
    wired_through: point.through,
  };
}

/**
 * Join names the way a sentence lists them.
 * @param names - The names
 * @returns For example `claude, codex and cursor`
 */
function listed(names: readonly string[]): string {
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Say what became of the agent points in one sentence.
 * @param points - The agent points
 * @returns The sentence; empty when there are no agent points
 */
function agentSentence(points: readonly CarrierPoint[]): string {
  const named = (outcomes: readonly string[]): readonly string[] =>
    points
      .filter(point => outcomes.includes(point.outcome))
      .flatMap(point => (point.agent === undefined ? [] : [point.agent]));
  const wired = named(["installed", "updated", "already-wired"]);
  const gaps = named(["unenforceable"]);
  const blocked = points.filter(point => point.outcome === "blocked");
  return [
    wired.length === 0
      ? ""
      : `After a file write, the declared checks run on ${listed(wired)}.`,
    gaps.length === 0
      ? ""
      : `${listed(gaps)} ${gaps.length === 1 ? "has" : "have"} no hook that can refuse a file write, so nothing was installed there.`,
    blocked.length === 0
      ? ""
      : `The declared checks do not run after a file write on ${listed(named(["blocked"]))}. ${blocked[0]?.reason ?? ""}`,
  ]
    .filter(part => part !== "")
    .join(" ");
}

/**
 * Work out the agent points of a result from the run's plan.
 * @param facts - What the run planned and did
 * @returns The points and the sentence about them
 */
export function describeAgentPoints(facts: CarrierRunFacts): DescribedAgents {
  const points = facts.plans.flatMap(plan =>
    plan.points.flatMap(point => {
      if (!isAgentPlan(point)) return [];
      return [
        point.through === NO_HOOK_SURFACE
          ? reportedGap(plan.kind, point, facts)
          : reportedHook(plan.kind, point, facts),
      ];
    })
  );
  return { points, sentence: agentSentence(points) };
}
