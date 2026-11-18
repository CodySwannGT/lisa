/**
 * Whether each enforcement point a register entry declares now runs its
 * check, as far as the enforce step can say.
 *
 * A register entry says where its rule is checked. The enforce step is
 * answerable for some of those places and not for others, and this module
 * says which, in one table:
 *
 * | Where | Who answers | The point is |
 * | --- | --- | --- |
 * | The checkout, at commit and at push | The carriers result | `wired` when the carrier is installed or was already there; `blocked` when the result says it is, or says nothing about the moment |
 * | The coding agent, after a file write | The carriers result's agent points | `blocked` when any named agent is blocked, when no agent that can refuse a write was named, and for a declared command when no agent was named at all; otherwise `wired`, naming the agents that cannot refuse and the ones whose refusal is assumed |
 * | The coding agent, at any other moment | Nobody | `not-checked`: Lisa's plugin runs those, and the enforce step installs nothing there |
 * | The hosting platform, an entry merge protection is asked to require | The merge-protection result | `wired` or `blocked`, as it says |
 * | The hosting platform, a pipeline file the host wrote | The file itself | `blocked` when it is absent or does not start the gate runner; otherwise as merge protection says, and `wired` with a note that it is unproved when merge protection says nothing |
 * | The hosting platform, anything else | Nobody | `not-checked` |
 * | A deployment pipeline, a scheduled run | Nobody | `not-checked` |
 *
 * ## What an entry's points add up to
 *
 * | The entry's points | The entry is |
 * | --- | --- |
 * | It has none: every moment is switched off | `nothing-to-enforce` |
 * | Any point is `blocked` | `blocked` |
 * | Otherwise, at least one is `wired` | `wired` |
 * | None was checked, and the check is a command the repository declares | `blocked`: nothing Lisa ships starts a command there |
 * | None was checked, and the check is one a Lisa project type ships | `nothing-to-enforce`: what Lisa ships runs it, and this step did not look |
 *
 * `wired` therefore always rests on a result a step reported, never on
 * silence.
 * @module controls/enforce-points
 */
import { CARRIER_RUNNER_PATH } from "./carrier-types.js";
import { EDIT_TIME_MOMENT } from "./coding-agents.js";
import type {
  HandedCarrierPoint,
  HandedCarriers,
  HandedProtect,
} from "./enforce-inputs.js";
import {
  NOTHING_TO_ENFORCE,
  type EnforcedEntry,
  type EnforcedEntryOutcome,
  type EnforcedPoint,
  type EnforcedPointState,
} from "./enforce-types.js";
import { platformLabel } from "./protect-platform.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import type { PointVerdict } from "./reconcile-types.js";
import {
  mechanismAt,
  type ControlRegister,
  type ControlRegisterEntry,
  type EnforcementLocation,
  type EnforcementPoint,
  type PullRequestExecutor,
} from "./register-types.js";

/** Everything the points are judged from. */
export interface EnforcedPointSources {
  /** The result of installing the carriers. */
  readonly carriers: HandedCarriers;
  /** The comparison of merge protection with the register. */
  readonly protect: HandedProtect;
  /** Reads the pipeline file a register names and says whether it is wired. */
  readonly executorVerdict: (
    executor: PullRequestExecutor
  ) => Promise<PointVerdict>;
}

/** What was reported of one point, before it is tied to the point. */
type PointFinding = Pick<EnforcedPoint, "state" | "reason">;

/** The state of a point the enforce step neither installs nor looks at. */
const NOT_CHECKED = "not-checked";

/** How an agent point with no agent's name on it is spoken of. */
const SOME_AGENT = "an agent";

/** The carrier outcomes that mean a carrier is in place. */
const IN_PLACE: readonly string[] = ["installed", "updated", "already-wired"];

/** What runs a check at each place nobody in the enforce step answers for. */
const UNCHECKED_PLACE: Readonly<Record<EnforcementLocation, string>> = {
  "coding-agent": "the Lisa plugin of each coding agent",
  "deployment-pipeline": "the deployment pipeline",
  "hosting-platform": "the pipeline that runs on a proposed change",
  "local-checkout": "git",
  "scheduled-run": "the scheduled run",
};

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
 * Say that the enforce step neither installs nor looks at a point.
 * @param point - The enforcement point
 * @returns The finding
 */
function notChecked(point: EnforcementPoint): PointFinding {
  return {
    reason: `The enforce step installs nothing at ${point.moment} and has no way to look there. A check there runs only when ${UNCHECKED_PLACE[point.location]} starts it.`,
    state: NOT_CHECKED,
  };
}

/**
 * Judge a commit or push point from the carriers result.
 * @param point - The enforcement point
 * @param carriers - The carriers result
 * @returns The finding
 */
function checkoutPoint(
  point: EnforcementPoint,
  carriers: HandedCarriers
): PointFinding {
  const carried = carriers.enforcement_points.find(
    each => each.location === point.location && each.moment === point.moment
  );
  if (carried === undefined) {
    return {
      reason: `The carriers result says nothing about ${point.moment}, so nothing is known to run this check there. Run "lisa controls install-carriers" again.`,
      state: "blocked",
    };
  }
  return IN_PLACE.includes(carried.outcome)
    ? {
        reason: `Git starts the declared checks at ${point.moment} in this checkout.`,
        state: "wired",
      }
    : {
        reason:
          carried.reason ??
          `Git does not start the declared checks at ${point.moment} in this checkout.`,
        state: "blocked",
      };
}

/**
 * Say what holds for an edit-time point where at least one agent is wired.
 * @param agents - The agent points of the carriers result
 * @returns The sentence, naming the agents that cannot refuse a write and
 *   the ones whose refusal nobody has measured
 */
function wiredAgentsReason(agents: readonly HandedCarrierPoint[]): string {
  const names = (points: readonly HandedCarrierPoint[]): string =>
    sentenceList(points.map(point => point.agent ?? SOME_AGENT));
  const wired = agents.filter(point => IN_PLACE.includes(point.outcome));
  const cannot = agents.filter(point => point.outcome === "unenforceable");
  const assumed = wired.filter(point => point.refusal_evidence === "assumed");
  return [
    `After a file write, the declared checks run on ${names(wired)}.`,
    ...(cannot.length > 0
      ? [
          `${names(cannot)} ${cannot.length === 1 ? "has" : "have"} no hook that can refuse a file write, so the check is not enforced there; the control register records that.`,
        ]
      : []),
    ...(assumed.length > 0
      ? [
          `On ${names(assumed)}, that a failed check stops the agent is assumed, not measured.`,
        ]
      : []),
  ].join(" ");
}

/**
 * Judge an edit-time point from the carriers result's agent points.
 * @param entry - The register entry
 * @param point - The enforcement point
 * @param carriers - The carriers result
 * @returns The finding
 */
function editTimePoint(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  carriers: HandedCarriers
): PointFinding {
  const agents = carriers.enforcement_points.filter(
    each => each.location === point.location && each.moment === point.moment
  );
  if (agents.length === 0) {
    return mechanismAt(entry, point).kind === "command"
      ? {
          reason: `No coding agent was named when the carriers were installed, so nothing runs this check after an agent writes a file. Run "lisa controls install-carriers --agents=<names>" with the agents that work on this repository.`,
          state: "blocked",
        }
      : notChecked(point);
  }
  const blocked = agents.filter(each => each.outcome === "blocked");
  if (blocked.length > 0) {
    return {
      reason: blocked
        .map(
          each =>
            `On ${each.agent ?? SOME_AGENT}: ${each.reason ?? "the check does not run after a file write."}`
        )
        .join(" "),
      state: "blocked",
    };
  }
  return agents.some(each => IN_PLACE.includes(each.outcome))
    ? { reason: wiredAgentsReason(agents), state: "wired" }
    : {
        reason: `None of the coding agents named (${sentenceList(agents.map(each => each.agent ?? SOME_AGENT))}) has a hook that can refuse a file write, so nothing can enforce this check after an edit.`,
        state: "blocked",
      };
}

/**
 * Judge a point enforced by a coding agent.
 * @param entry - The register entry
 * @param point - The enforcement point
 * @param sources - What the points are judged from
 * @returns The finding
 */
function agentPoint(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  sources: EnforcedPointSources
): PointFinding {
  return point.moment === EDIT_TIME_MOMENT
    ? editTimePoint(entry, point, sources.carriers)
    : notChecked(point);
}

/**
 * Judge a pull-request point from the merge-protection result and, where the
 * host wrote the pipeline, from the pipeline file.
 * @param entry - The register entry
 * @param point - The enforcement point
 * @param sources - What the points are judged from
 * @returns The finding
 */
async function platformPoint(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  sources: EnforcedPointSources
): Promise<PointFinding> {
  const hosted =
    point.executor !== undefined && !isWrittenByLisa(point.executor)
      ? point.executor
      : null;
  const file = hosted === null ? null : await sources.executorVerdict(hosted);
  if (file !== null && file.state !== "wired") {
    return { reason: file.reason, state: "blocked" };
  }
  const unproved =
    hosted === null
      ? ""
      : ` Lisa did not write ${hosted.path} and nothing in this release can prove a check on ${platformLabel(hosted.platform)}, so this entry stays marked unproved.`;
  const required = sources.protect.entries.find(each => each.id === entry.id);
  if (required !== undefined) {
    return {
      reason: `${required.reason}${unproved}`,
      state: required.outcome,
    };
  }
  return file === null
    ? {
        reason: `The register does not ask the hosting platform to require this check before a merge (it is ${point.level} there, and the entry is ${entry.tier}), so merge protection says nothing about it.`,
        state: NOT_CHECKED,
      }
    : { reason: `${file.reason}${unproved}`, state: "wired" };
}

/**
 * Judge one enforcement point.
 * @param entry - The register entry
 * @param point - One of its enforcement points
 * @param sources - What the points are judged from
 * @returns The finding
 */
function judgePoint(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  sources: EnforcedPointSources
): Promise<PointFinding> | PointFinding {
  if (point.location === "local-checkout") {
    return checkoutPoint(point, sources.carriers);
  }
  if (point.location === "coding-agent") {
    return agentPoint(entry, point, sources);
  }
  return point.location === "hosting-platform"
    ? platformPoint(entry, point, sources)
    : notChecked(point);
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
 * Say what an entry whose points were all left unchecked comes to.
 * @param entry - The register entry
 * @param points - Its points, none of them checked
 * @returns The outcome and the reason
 */
function uncheckedEntry(
  entry: ControlRegisterEntry,
  points: readonly EnforcedPoint[]
): Pick<EnforcedEntry, "outcome" | "reason"> {
  const [first] = entry.enforcement_points;
  const declared =
    first !== undefined && mechanismAt(entry, first).kind === "command";
  return declared
    ? {
        outcome: "blocked",
        reason: `This check is declared only at ${momentsOf(points)}, where nothing Lisa installs starts it. Whoever maintains that pipeline has to make it run "node ${CARRIER_RUNNER_PATH} --moment=<moment>" and stop when that fails, or a different moment has to be chosen in the configure step.`,
      }
    : {
        outcome: NOTHING_TO_ENFORCE,
        reason: `This check runs at ${momentsOf(points)} through what a Lisa project type ships (its plugin and its pipelines). The enforce step installs nothing for it and did not check it.`,
      };
}

/**
 * Add an entry's points up.
 * @param entry - The register entry
 * @param points - What was reported of each of its points
 * @returns The outcome and the reason
 */
function entryOutcome(
  entry: ControlRegisterEntry,
  points: readonly EnforcedPoint[]
): Pick<EnforcedEntry, "outcome" | "reason"> {
  const having = (state: EnforcedPointState): readonly EnforcedPoint[] =>
    points.filter(point => point.state === state);
  if (points.length === 0) {
    return {
      outcome: NOTHING_TO_ENFORCE,
      reason:
        "The declaration switches this check off at every moment, so there is nothing to run.",
    };
  }
  const blocked = having("blocked");
  if (blocked.length > 0) {
    const outcome: EnforcedEntryOutcome = "blocked";
    return {
      outcome,
      reason: blocked
        .map(point => `At ${point.moment}: ${point.reason}`)
        .join(" "),
    };
  }
  const wired = having("wired");
  if (wired.length === 0) return uncheckedEntry(entry, points);
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

/**
 * Judge every entry of a register.
 * @param register - The control register the declaration generates
 * @param sources - What the points are judged from
 * @returns One judged entry per register entry, in register order
 */
export async function enforcedEntries(
  register: ControlRegister,
  sources: EnforcedPointSources
): Promise<readonly EnforcedEntry[]> {
  return Promise.all(
    register.entries.map(async entry => {
      const findings = await Promise.all(
        entry.enforcement_points.map(point => judgePoint(entry, point, sources))
      );
      const points = entry.enforcement_points.map((point, index) => ({
        level: point.level,
        location: point.location,
        moment: point.moment,
        ...(findings[index] ?? notChecked(point)),
      }));
      return {
        criteria: entry.criteria,
        gate: entry.gate,
        id: entry.id,
        scope: entry.scope,
        ...entryOutcome(entry, points),
        points,
      };
    })
  );
}
