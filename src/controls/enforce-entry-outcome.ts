/**
 * What a register entry's enforcement points add up to.
 *
 * `./enforce-points.ts` says of each point whether something runs the check
 * there. This module turns the points of one entry into the entry's one
 * outcome:
 *
 * | The entry's points | The entry is |
 * | --- | --- |
 * | It has none, and it serves a requirement a check can refuse a change for | `blocked`: no moment was chosen, so nothing runs it; the configure step has to choose when it runs |
 * | It has none, and it serves no such requirement | `nothing-to-enforce` |
 * | Any point is `blocked` | `blocked` |
 * | Otherwise, at least one is `wired` | `wired` |
 * | None was checked, and the check is a command the repository declares | `blocked`: nothing Lisa ships starts a command there |
 * | None was checked, and the check is one a Lisa project type ships (a task, an interceptor, a built-in job) | `nothing-to-enforce`: what Lisa ships runs it, and this step did not look |
 * | None was checked, the check is one another system reports or nothing measures it, and it serves a requirement a check can refuse a change for | `blocked`: nothing Lisa ships runs it and this step cannot see that anything waits for it; the configure step has to choose when it must pass |
 * | None was checked, the same kind of check, and it serves no such requirement | `nothing-to-enforce` |
 *
 * ## Why an entry with no moment is not "nothing to enforce"
 *
 * A requirement the catalogue calls a gate is met only by a check that can
 * refuse a change. An entry that declares such a check and no moment to run
 * it at would otherwise count as the requirement's answer, and the operator
 * would be told the requirement needs nothing switched on while nothing at
 * all runs. `nothing-to-enforce` is kept for what truly asks nothing of this
 * step.
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
  type MechanismKind,
} from "./register-types.js";

/** The state of a point the enforce step neither installs nor looks at. */
export const NOT_CHECKED = "not-checked";

/** The outcome and the reason of one entry. */
type EntryOutcome = Pick<EnforcedEntry, "outcome" | "reason">;

/** The kinds of check a Lisa project type ships and runs itself. */
const SHIPPED_KINDS: readonly MechanismKind[] = [
  "task",
  "interceptor",
  "built-in",
];

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
 * Say what an entry with no enforcement point comes to.
 * @param servesGate - Whether it serves a requirement a check can refuse a
 *   change for
 * @returns The outcome and the reason
 */
function momentlessEntry(servesGate: boolean): EntryOutcome {
  return servesGate
    ? {
        outcome: "blocked",
        reason: `The declaration gives this check no moment to run at: none was chosen, or every one is switched off. So nothing runs it, and the requirement it is declared for is not checked. ${CONFIGURE}`,
      }
    : {
        outcome: NOTHING_TO_ENFORCE,
        reason:
          "The declaration switches this check off at every moment, so there is nothing to run.",
      };
}

/**
 * Say what an entry whose points were all left unchecked comes to.
 * @param entry - The register entry
 * @param points - Its points, none of them checked
 * @param servesGate - Whether it serves a requirement a check can refuse a
 *   change for
 * @returns The outcome and the reason
 */
function uncheckedEntry(
  entry: ControlRegisterEntry,
  points: readonly EnforcedPoint[],
  servesGate: boolean
): EntryOutcome {
  const [first] = entry.enforcement_points;
  const kind = first === undefined ? "none" : mechanismAt(entry, first).kind;
  const moments = momentsOf(points);
  if (kind === "command") {
    return {
      outcome: "blocked",
      reason: `This check is declared only at ${moments}, where nothing Lisa installs starts it. Whoever maintains that pipeline has to make it run "node ${CARRIER_RUNNER_PATH} --moment=<moment>" and stop when that fails, or a different moment has to be chosen in the configure step.`,
    };
  }
  if (SHIPPED_KINDS.includes(kind)) {
    return {
      outcome: NOTHING_TO_ENFORCE,
      reason: `This check runs at ${moments} through what a Lisa project type ships (its plugin and its pipelines). The enforce step installs nothing for it and did not check it.`,
    };
  }
  const what =
    kind === "external-check"
      ? "Another system reports this check, and nothing Lisa ships runs it."
      : "Nothing is declared that measures this check.";
  const where = `It is declared only at ${moments}, where the enforce step installs nothing and has no way to see whether anything waits for it.`;
  return servesGate
    ? { outcome: "blocked", reason: `${what} ${where} ${CONFIGURE}` }
    : { outcome: NOTHING_TO_ENFORCE, reason: `${what} ${where}` };
}

/**
 * Add an entry's points up.
 * @param entry - The register entry
 * @param points - What was reported of each of its points
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
  if (points.length === 0) return momentlessEntry(servesGate);
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
  if (wired.length === 0) return uncheckedEntry(entry, points, servesGate);
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
