/**
 * Reading the carriers of the checkout itself, so that the enforce report
 * never rests on a saved file alone.
 *
 * The report is handed what `lisa controls install-carriers` printed when
 * the enforce step ran it. That file says what a run did at one moment, and
 * it is a file: it can be the output of a `--check` run that installed
 * nothing, it can be from an earlier run, and a hook can have been removed
 * since. A report that believed it would say a check runs at commit in a
 * checkout where nothing runs it.
 *
 * So the report reads the checkout again, with the same read
 * `lisa controls reconcile` makes: the carrier check, which writes nothing,
 * turned into an answer about each point by `./reconcile-carrier-points.ts`.
 *
 * ## Which of the two is believed
 *
 * | The saved result says | Reading the checkout shows | The point is | The report says |
 * | --- | --- | --- | --- |
 * | in place | in place | in place | nothing more |
 * | in place | not in place | not in place | that the saved result said otherwise |
 * | blocked, or nothing | in place | in place | that the saved result said otherwise |
 * | anything | an agent with no hook that can refuse a write | cannot refuse | that the saved result said otherwise, when it did |
 *
 * The read of the checkout always wins. The saved result is still what the
 * report takes the run's changes from, and what names the coding agents to
 * look for: the check is run for exactly the agents the saved result has a
 * point for.
 * @module controls/enforce-carriers
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentRefusal,
  CarrierPoint,
  RefusalEvidence,
  WiredThrough,
} from "./carrier-types.js";
import { installCarriers, type CarrierRun } from "./carriers.js";
import type {
  HandedCarrierPoint,
  HandedCarriers,
} from "./enforce-input-types.js";
import { carrierVerdict } from "./reconcile-carrier-points.js";
import type { EnforcementLocation } from "./register-types.js";

/** How one carrier stands in the checkout now. */
export type InstalledCarrierState = "in-place" | "not-in-place" | "no-hook";

/** One enforcement point a carrier serves, as the checkout holds it now. */
export interface InstalledCarrier {
  readonly location: EnforcementLocation;
  readonly moment: string;
  /** The coding agent the point belongs to; only an agent point has it. */
  readonly agent?: string;
  /**
   * - `in-place`: something starts the declared checks there now.
   * - `not-in-place`: it was looked for and is not there, or is blocked.
   * - `no-hook`: a coding agent with no hook that can refuse a file write.
   */
  readonly state: InstalledCarrierState;
  /** Why, as the read of the checkout says it. */
  readonly reason: string;
  /** What calls the carrier there. */
  readonly wired_through: WiredThrough;
  /** How the agent is told a write failed; only a wired agent point. */
  readonly refusal?: AgentRefusal;
  /** How it is known the agent acts on that; only a wired agent point. */
  readonly refusal_evidence?: RefusalEvidence;
  /**
   * What to tell the operator when the saved carriers result said something
   * else about this point; `null` when the two agree.
   */
  readonly contradicts: string | null;
}

/** Runs the carrier check of a checkout for some agents, writing nothing. */
export type CarrierCheck = (
  root: string,
  agents: readonly string[]
) => Promise<CarrierRun>;

/** The carriers of a checkout as they are now, or why they are not known. */
export type InstalledCarriersRead =
  | { readonly problems: null; readonly carriers: readonly InstalledCarrier[] }
  | { readonly problems: readonly string[] };

/** The carrier outcomes that mean a carrier is in place. */
const IN_PLACE: readonly string[] = ["installed", "updated", "already-wired"];

/** What each state is called when the two sources are set side by side. */
const SAID: Readonly<Record<InstalledCarrierState, string>> = {
  "in-place": "is in place",
  "no-hook": "belongs to a coding agent that cannot refuse a file write",
  "not-in-place": "is not in place",
};

/**
 * Run the carrier check of a checkout, writing nothing.
 * @param root - Real path of the repository
 * @param agents - The coding agents to look for
 * @returns The check's result, or why there is none
 */
function checkCarriers(
  root: string,
  agents: readonly string[]
): Promise<CarrierRun> {
  return installCarriers(
    root,
    agents.length === 0
      ? { check: true }
      : { agents: { from: "named", names: agents }, check: true }
  );
}

/**
 * Read a file's text.
 * @param file - The file
 * @returns The text, or `null` when it cannot be read
 */
async function textOf(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Say how the saved result put one point, in the words of {@link SAID}.
 * @param handed - The point of the saved result, when it has one
 * @returns The state it claims; `null` when it says nothing about the point
 */
function claimed(
  handed: HandedCarrierPoint | undefined
): InstalledCarrierState | null {
  if (handed === undefined) return null;
  if (handed.outcome === "unenforceable") return "no-hook";
  return IN_PLACE.includes(handed.outcome) ? "in-place" : "not-in-place";
}

/**
 * Say that the saved result and the checkout disagree about a point.
 * @param handed - The point of the saved result, when it has one
 * @param state - What reading the checkout shows
 * @returns The sentence, or `null` when the two agree
 */
function contradiction(
  handed: HandedCarrierPoint | undefined,
  state: InstalledCarrierState
): string | null {
  const before = claimed(handed);
  if (before === state) return null;
  const saved =
    before === null
      ? "says nothing about this carrier"
      : `says this carrier ${SAID[before]}`;
  return `The carriers result that was handed in ${saved}; this checkout was read again just now and the carrier ${SAID[state]}. What the checkout holds now is what is reported.`;
}

/**
 * Read the carriers of a checkout as they are now, and set each beside what
 * the saved carriers result said of it.
 * @param root - Real path of the repository
 * @param handed - The saved carriers result
 * @param check - Runs the carrier check; the real one when left out
 * @returns One carrier per point the check reports, or why none is known
 */
export async function readInstalledCarriers(
  root: string,
  handed: HandedCarriers,
  check: CarrierCheck = checkCarriers
): Promise<InstalledCarriersRead> {
  const agents = [
    ...new Set(handed.enforcement_points.flatMap(point => point.agent ?? [])),
  ];
  const run = await check(root, agents).catch(
    (error: unknown): CarrierRun => ({
      problems: [error instanceof Error ? error.message : String(error)],
    })
  );
  if (run.problems !== null) {
    return {
      problems: [
        "The carriers of this checkout could not be read, so whether the declared checks run here is not known.",
        ...run.problems,
      ],
    };
  }
  const { result } = run;
  const read = (shown: string): Promise<string | null> =>
    textOf(path.isAbsolute(shown) ? shown : path.join(root, shown));
  const stateOf = async (
    point: CarrierPoint
  ): Promise<Pick<InstalledCarrier, "state" | "reason">> => {
    if (point.outcome === "unenforceable") {
      return { reason: point.reason ?? "", state: "no-hook" };
    }
    const verdict = await carrierVerdict(point, result, read);
    return {
      reason: verdict.reason,
      state: verdict.state === "wired" ? "in-place" : "not-in-place",
    };
  };
  const carriers = await Promise.all(
    result.enforcement_points.map(async (point): Promise<InstalledCarrier> => {
      const found = await stateOf(point);
      const saved = handed.enforcement_points.find(
        each =>
          each.location === point.location &&
          each.moment === point.moment &&
          each.agent === point.agent
      );
      return {
        ...found,
        contradicts: contradiction(saved, found.state),
        location: point.location,
        moment: point.moment,
        wired_through: point.wired_through,
        ...(point.agent === undefined ? {} : { agent: point.agent }),
        ...(point.refusal === undefined ? {} : { refusal: point.refusal }),
        ...(point.refusal_evidence === undefined
          ? {}
          : { refusal_evidence: point.refusal_evidence }),
      };
    })
  );
  return { carriers, problems: null };
}
