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
 * | The checkout, at commit and at push | A read of the checkout's carriers, made for this report | `wired` when the carrier is in place now; `blocked` when it is not, or when the read reports no carrier for the moment |
 * | The coding agent, after a file write | The same read, for the agents the saved carriers result names | `blocked` when any named agent's carrier is not in place, when no agent that can refuse a write was named, and for a declared command when no agent was named at all; otherwise `wired`, naming the agents that cannot refuse, the ones that are only told afterwards, and the ones whose refusal is assumed |
 * | The coding agent, at any other moment | Nobody | `not-checked`: Lisa's plugin runs those, and the enforce step installs nothing there |
 * | The hosting platform, an entry merge protection is asked to require | The merge-protection result | `wired` or `blocked`, as it says |
 * | The hosting platform, a pipeline file the host wrote | The file itself | `blocked` when it is absent or does not start the gate runner; otherwise as merge protection says, and `wired` with a note that it is unproved when merge protection says nothing |
 * | The hosting platform, anything else | Nobody | `not-checked` |
 * | A deployment pipeline, a scheduled run | Nobody | `not-checked` |
 *
 * The saved carriers result is never believed on its own
 * (`./enforce-carriers.ts`): where it and the read of the checkout disagree,
 * the read wins and the point's reason says so.
 *
 * What an entry's points add up to is `./enforce-entry-outcome.ts`.
 * @module controls/enforce-points
 */
import { EDIT_TIME_MOMENT } from "./coding-agents.js";
import type { InstalledCarrier } from "./enforce-carriers.js";
import { NOT_CHECKED, entryOutcome } from "./enforce-entry-outcome.js";
import type { HandedProtect } from "./enforce-inputs.js";
import type { EnforcedEntry, EnforcedPoint } from "./enforce-types.js";
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
  /** The carriers of the checkout as a read made for this report found them. */
  readonly installed: readonly InstalledCarrier[];
  /** Whether a supported project type supplies its usual checks. */
  readonly hasSupportedProjectType: boolean;
  /** The comparison of merge protection with the register. */
  readonly protect: HandedProtect;
  /** Reads the pipeline file a register names and says whether it is wired. */
  readonly executorVerdict: (
    executor: PullRequestExecutor
  ) => Promise<PointVerdict>;
  /**
   * The ids of the requirements a check can refuse a change for: the ones
   * the catalogue calls a gate.
   */
  readonly gateCriteria: readonly string[];
}

/** What was reported of one point, before it is tied to the point. */
type PointFinding = Pick<EnforcedPoint, "state" | "reason">;

/** How an agent point with no agent's name on it is spoken of. */
const SOME_AGENT = "an agent";

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
 * Join the sentences that are there.
 * @param parts - Sentences, and `null` for one that does not apply
 * @returns The ones that apply, one space apart
 */
function sentences(parts: readonly (string | null)[]): string {
  return parts.filter(part => part !== null && part !== "").join(" ");
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
 * Judge a commit or push point from the read of the checkout's carriers.
 * @param point - The enforcement point
 * @param installed - The carriers of the checkout as they are now
 * @returns The finding
 */
function checkoutPoint(
  point: EnforcementPoint,
  installed: readonly InstalledCarrier[]
): PointFinding {
  const carrier = installed.find(
    each => each.location === point.location && each.moment === point.moment
  );
  if (carrier === undefined) {
    return {
      reason: `Reading this checkout found no carrier for ${point.moment}, so nothing is known to run this check there. Run "lisa controls install-carriers" again.`,
      state: "blocked",
    };
  }
  return carrier.state === "in-place"
    ? {
        reason: sentences([
          `Git starts the declared checks at ${point.moment} in this checkout.`,
          point.level === "optional"
            ? `This check is optional, so a failure does not stop the ${point.moment}.`
            : null,
          carrier.contradicts,
        ]),
        state: "wired",
      }
    : {
        reason: sentences([
          carrier.reason === ""
            ? `Git does not start the declared checks at ${point.moment} in this checkout.`
            : carrier.reason,
          carrier.contradicts,
        ]),
        state: "blocked",
      };
}

/**
 * Name the agents of some carriers.
 * @param carriers - Agent carriers
 * @returns The agents, as a sentence lists them
 */
function agentsOf(carriers: readonly InstalledCarrier[]): string {
  return sentenceList(carriers.map(carrier => carrier.agent ?? SOME_AGENT));
}

/**
 * Say what holds for an edit-time point where at least one agent is wired.
 * @param agents - The agent carriers of the checkout
 * @returns The sentence, naming the agents that cannot refuse a write, the
 *   ones that are only told of a failure, and the ones whose refusal nobody
 *   has measured
 */
function wiredAgentsReason(agents: readonly InstalledCarrier[]): string {
  const wired = agents.filter(carrier => carrier.state === "in-place");
  const cannot = agents.filter(carrier => carrier.state === "no-hook");
  const told = wired.filter(
    carrier => carrier.refusal === "additional-context"
  );
  const assumed = wired.filter(
    carrier => carrier.refusal_evidence === "assumed"
  );
  return sentences([
    `After a file write, the declared checks run on ${agentsOf(wired)}.`,
    cannot.length > 0
      ? `${agentsOf(cannot)} ${cannot.length === 1 ? "has" : "have"} no hook that can refuse a file write, so the check is not enforced there; the control register records that.`
      : null,
    told.length > 0
      ? `On ${agentsOf(told)}, a failed check does not fail the write: the agent is told afterwards, and nothing stops it going on.`
      : null,
    assumed.length > 0
      ? `On ${agentsOf(assumed)}, that a failed check stops the agent is assumed, not measured.`
      : null,
    ...agents.map(carrier => carrier.contradicts),
  ]);
}

/**
 * Judge an edit-time point from the read of the checkout's agent carriers.
 * @param entry - The register entry
 * @param point - The enforcement point
 * @param installed - The carriers of the checkout as they are now
 * @returns The finding
 */
function editTimePoint(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  installed: readonly InstalledCarrier[]
): PointFinding {
  const agents = installed.filter(
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
  const blocked = agents.filter(each => each.state === "not-in-place");
  if (blocked.length > 0) {
    return {
      reason: blocked
        .map(each =>
          sentences([
            `On ${each.agent ?? SOME_AGENT}: ${each.reason === "" ? "the check does not run after a file write." : each.reason}`,
            each.contradicts,
          ])
        )
        .join(" "),
      state: "blocked",
    };
  }
  return agents.some(each => each.state === "in-place")
    ? { reason: wiredAgentsReason(agents), state: "wired" }
    : {
        reason: `None of the coding agents named (${agentsOf(agents)}) has a hook that can refuse a file write, so nothing can enforce this check after an edit.`,
        state: "blocked",
      };
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
    return checkoutPoint(point, sources.installed);
  }
  if (point.location === "coding-agent") {
    return point.moment === EDIT_TIME_MOMENT
      ? editTimePoint(entry, point, sources.installed)
      : notChecked(point);
  }
  return point.location === "hosting-platform"
    ? platformPoint(entry, point, sources)
    : notChecked(point);
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
        ...entryOutcome(
          entry,
          points,
          entry.criteria.some(id => sources.gateCriteria.includes(id)),
          sources.hasSupportedProjectType
        ),
        points,
      };
    })
  );
}
