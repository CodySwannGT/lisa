/**
 * What a register entry's enforcement points add up to.
 *
 * `./enforce-points.ts` says of each point whether something runs the check
 * there. This module turns the points of one entry into the entry's one
 * outcome:
 *
 * | The entry's points | The entry is |
 * | --- | --- |
 * | It has none | `nothing-to-enforce`, and it makes no claim about any requirement: `./enforce-claims.ts` leaves it out |
 * | Any point is `blocked` | `blocked` |
 * | Otherwise, at least one is `wired` | `wired` |
 * | None was checked, and at one of them the check is one Lisa itself ships | `nothing-to-enforce`: what Lisa ships runs it, and this step did not look |
 * | None was checked, none is one Lisa ships, and at one of them the check is a command the repository declares | `blocked`: nothing Lisa installs starts a command there |
 * | None was checked, the check is a task the repository declares under a gate of its own, one another system reports, or nothing measures it, and it serves a requirement a check can refuse a change for | `blocked`: nothing Lisa ships runs it and this step cannot see that anything does; the configure step has to choose when it must pass |
 * | None was checked, the same kinds of check, and it serves no such requirement | `nothing-to-enforce` |
 *
 * Every row about unchecked points goes by the check at each point, not by
 * the first point alone: a gate can be measured differently at different
 * moments.
 *
 * ## What counts as a check Lisa ships
 *
 * An interceptor, a built-in job of the shipped workflow, and a task under
 * one of the gate registry's own ids: a Lisa project type brings the plugin
 * and the pipelines that run those. A task under a gate the repository
 * invented (an id starting with {@link HOST_GATE_PREFIX}) is not one of
 * them. Any gate that names a task to run is recorded as a task, so going by
 * that alone would say of a host's own lint script, declared where this step
 * cannot look, that Lisa runs it, in a repository where nothing does.
 *
 * ## Why an entry with no moment makes no claim
 *
 * A requirement the catalogue calls a gate is met only by a check that can
 * refuse a change. An entry with no moment to run at is not such a check, so
 * it must not count as the requirement's answer. It must not block the
 * requirement either: a repository that switches one gate off everywhere and
 * serves the same requirement through another has that requirement checked,
 * and the switched-off gate asks nothing of anybody. So the entry says
 * nothing, the other entries and the audit's findings decide, and a
 * requirement that only such entries serve is `blocked` from the audit's
 * finding (`./enforce-claims.ts`).
 *
 * `wired` therefore always rests on a result a step reported, never on
 * silence.
 * @module controls/enforce-entry-outcome
 */
import { CARRIER_RUNNER_PATH } from "./carrier-types.js";
import {
  NOTHING_TO_ENFORCE,
  type EnforcedEntry,
  type EnforcedPoint,
  type EnforcedPointState,
} from "./enforce-types.js";
import {
  mechanismAt,
  type ControlRegisterEntry,
  type MeasuringMechanism,
} from "./register-types.js";

/** The state of a point the enforce step neither installs nor looks at. */
export const NOT_CHECKED = "not-checked";

/**
 * How the id of a gate a repository invented starts. The gate registry
 * decides this (`CUSTOM_PREFIX` in the shipped `lisa-gates.mjs`), and a suite
 * holds this copy to it.
 */
export const HOST_GATE_PREFIX = "x-";

/** The outcome and the reason of one entry. */
type EntryOutcome = Pick<EnforcedEntry, "outcome" | "reason">;

/** One unchecked point, with what measures the check there. */
interface UncheckedPoint {
  readonly point: EnforcedPoint;
  readonly mechanism: MeasuringMechanism;
}

/** What the operator is asked for when only the configure step can go on. */
const CONFIGURE =
  "Waiting on you: run the configure step and choose when this check has to pass.";

/**
 * Join some names the way a sentence lists them.
 * @param names - At least one name
 * @returns `a`, `a and b`, or `a, b and c`
 */
function sentenceList(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Name the moments of some points.
 * @param points - The points
 * @returns Their moments, as a sentence lists them
 */
function momentsOf(points: readonly EnforcedPoint[]): string {
  return sentenceList(points.map(point => point.moment));
}

/**
 * Tell whether an entry has no moment to run at: none was chosen, or every
 * one is switched off.
 * @param entry - A judged entry
 * @returns Whether nothing is declared to run it
 */
export function hasNoMoment(entry: Pick<EnforcedEntry, "points">): boolean {
  return entry.points.length === 0;
}

/** What an entry with no enforcement point comes to. */
const MOMENTLESS_ENTRY: EntryOutcome = {
  outcome: NOTHING_TO_ENFORCE,
  reason:
    "The declaration gives this check no moment to run at: none was chosen, or every one is switched off. So nothing runs it, there is nothing to wire, and it does not count as a check for any requirement it is declared for.",
};

/**
 * Tell whether a check is one Lisa itself ships and runs.
 * @param entry - The register entry
 * @param mechanism - What measures it at one point
 * @returns Whether a Lisa project type brings what runs it
 */
function isShipped(
  entry: ControlRegisterEntry,
  mechanism: MeasuringMechanism
): boolean {
  return (
    mechanism.kind === "interceptor" ||
    mechanism.kind === "built-in" ||
    (mechanism.kind === "task" && !entry.gate.startsWith(HOST_GATE_PREFIX))
  );
}

/**
 * Say what a check that is neither shipped by Lisa nor a declared command
 * is.
 * @param mechanism - What measures it
 * @returns One sentence
 */
function describeUnshipped(mechanism: MeasuringMechanism): string {
  if (mechanism.kind === "task") {
    return `This check is a task the repository declares itself ("${mechanism.command}"), under a gate of its own, and nothing Lisa ships runs it.`;
  }
  return mechanism.kind === "external-check"
    ? "Another system reports this check, and nothing Lisa ships runs it."
    : "Nothing is declared that measures this check.";
}

/**
 * Name the unchecked points a reason did not speak of.
 * @param rest - Those points
 * @returns A sentence with a leading space, or nothing
 */
function alsoUnchecked(rest: readonly UncheckedPoint[]): string {
  return rest.length === 0
    ? ""
    : ` Not checked by the enforce step: ${momentsOf(rest.map(each => each.point))}.`;
}

/**
 * Say what an entry whose points were all left unchecked comes to.
 * @param entry - The register entry
 * @param unchecked - Its points, none of them checked, each with what
 *   measures the check there
 * @param servesGate - Whether it serves a requirement a check can refuse a
 *   change for
 * @returns The outcome and the reason
 */
function uncheckedEntry(
  entry: ControlRegisterEntry,
  unchecked: readonly UncheckedPoint[],
  servesGate: boolean
): EntryOutcome {
  const split = (
    wanted: (each: UncheckedPoint) => boolean
  ): readonly [readonly UncheckedPoint[], readonly UncheckedPoint[]] => [
    unchecked.filter(wanted),
    unchecked.filter(each => !wanted(each)),
  ];
  const [shipped, unshipped] = split(each => isShipped(entry, each.mechanism));
  if (shipped.length > 0) {
    return {
      outcome: NOTHING_TO_ENFORCE,
      reason: `This check runs at ${momentsOf(shipped.map(each => each.point))} through what a Lisa project type ships (its plugin and its pipelines). The enforce step installs nothing for it and did not check it.${alsoUnchecked(unshipped)}`,
    };
  }
  const [commands, others] = split(each => each.mechanism.kind === "command");
  if (commands.length > 0) {
    return {
      outcome: "blocked",
      reason: `This check is a command the repository declares, and it is declared at ${momentsOf(commands.map(each => each.point))}, where nothing Lisa installs starts it. Whoever maintains that pipeline has to make it run "node ${CARRIER_RUNNER_PATH} --moment=<moment>" and stop when that fails, or a different moment has to be chosen in the configure step.${alsoUnchecked(others)}`,
    };
  }
  const what = [
    ...new Set(unchecked.map(each => describeUnshipped(each.mechanism))),
  ].join(" ");
  const where = `It is declared only at ${momentsOf(unchecked.map(each => each.point))}, where the enforce step installs nothing and has no way to see whether anything runs it or waits for it.`;
  return servesGate
    ? { outcome: "blocked", reason: `${what} ${where} ${CONFIGURE}` }
    : { outcome: NOTHING_TO_ENFORCE, reason: `${what} ${where}` };
}

/**
 * Add an entry's points up.
 * @param entry - The register entry
 * @param points - What was reported of each of its enforcement points, in
 *   the entry's own order
 * @param servesGate - Whether the entry serves a requirement a check can
 *   refuse a change for
 * @returns The outcome and the reason
 */
export function entryOutcome(
  entry: ControlRegisterEntry,
  points: readonly EnforcedPoint[],
  servesGate: boolean
): EntryOutcome {
  const having = (state: EnforcedPointState): readonly EnforcedPoint[] =>
    points.filter(point => point.state === state);
  if (points.length === 0) return MOMENTLESS_ENTRY;
  const blocked = having("blocked");
  if (blocked.length > 0) {
    return {
      outcome: "blocked",
      reason: blocked
        .map(point => `At ${point.moment}: ${point.reason}`)
        .join(" "),
    };
  }
  const wired = having("wired");
  if (wired.length === 0) {
    return uncheckedEntry(
      entry,
      points.map((point, index) => {
        const declared = entry.enforcement_points[index];
        return {
          mechanism:
            declared === undefined
              ? entry.measuring_mechanism
              : mechanismAt(entry, declared),
          point,
        };
      }),
      servesGate
    );
  }
  const unchecked = having(NOT_CHECKED);
  return {
    outcome: "wired",
    reason: [
      ...wired.map(point => point.reason),
      ...(unchecked.length > 0
        ? [`Not checked by the enforce step: ${momentsOf(unchecked)}.`]
        : []),
    ].join(" "),
  };
}
