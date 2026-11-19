/**
 * Direction one: every enforcement point the register claims, checked
 * against what is installed.
 *
 * A register entry says where its rule is enforced: at commit, at push, on a
 * pull request, before a deployment. Each of those is a claim that something
 * runs the rule there. This module asks, for each one, whether something
 * real does, and it asks the place that already knows:
 *
 * | Where | Who answers | What can be established |
 * | --- | --- | --- |
 * | The checkout (commit, push) | The carrier check | Whether git starts the gate runner there, in this checkout |
 * | The coding agent (edit time) | The carrier check, once it reports such points | The same; until then, not verifiable |
 * | The hosting platform, pipeline written by the host | The file the register names | Whether it is there and runs the runner's pull-request command, as text |
 * | The hosting platform, GitHub | The platform's merge settings, when asked | Whether the entry's checks are required before a merge |
 * | A deployment pipeline, a scheduled run | Nobody | Not verifiable by this command |
 *
 * A carrier point is matched to a register point by `location` and `moment`
 * and by nothing else, so a carrier of a kind this module has never seen is
 * picked up as soon as the check reports it.
 * @module controls/reconcile-points
 */
import type { CarrierResult } from "./carrier-types.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import {
  carrierVerdict,
  type ShownFileReader,
} from "./reconcile-carrier-points.js";
import { executorVerdict } from "./reconcile-executor.js";
import { platformVerdict, type PlatformRead } from "./reconcile-platform.js";
import type { PointVerdict, ReconciledPoint } from "./reconcile-types.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
  EnforcementLocation,
  EnforcementPoint,
} from "./register-types.js";

/** Everything the points are checked against. */
export interface PointSources {
  /** Real path of the repository. */
  readonly root: string;
  /** The result of the carrier check of this checkout. */
  readonly carriers: CarrierResult;
  /** What became of the read of the hosting platform. */
  readonly platform: PlatformRead;
  /** Reads a file by the path the carrier check shows it under. */
  readonly read: ShownFileReader;
}

/** Why a point with no one to answer for it cannot be verified. */
const NOBODY_ANSWERS: Readonly<
  Record<EnforcementLocation, (moment: string) => string>
> = {
  "coding-agent": moment =>
    `No carrier check covers the coding agent at ${moment} yet, so this command cannot say whether anything runs the rule there.`,
  "local-checkout": moment =>
    `The carrier check reported nothing for ${moment}, so this command cannot say whether anything runs the rule there.`,
  "hosting-platform": moment =>
    `This command has no way to look at the hosting platform at ${moment}.`,
  "deployment-pipeline": moment =>
    `This command does not look at deployment pipelines, so it cannot say whether anything runs the rule at ${moment}.`,
  "scheduled-run": moment =>
    `This command does not look at scheduled runs, so it cannot say whether anything runs the rule at ${moment}.`,
};

/**
 * Say what was established about one enforcement point.
 * @param entry - The register entry
 * @param point - One of its enforcement points
 * @param sources - What the point is checked against
 * @returns The verdict
 */
function verdictFor(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  sources: PointSources
): Promise<PointVerdict> | PointVerdict {
  const carried = sources.carriers.enforcement_points.find(
    each => each.location === point.location && each.moment === point.moment
  );
  if (carried !== undefined) {
    return carrierVerdict(carried, sources.carriers, sources.read);
  }
  if (point.location !== "hosting-platform") {
    return {
      checked: null,
      reason: NOBODY_ANSWERS[point.location](point.moment),
      state: "not-verifiable",
    };
  }
  return point.executor !== undefined && !isWrittenByLisa(point.executor)
    ? executorVerdict(sources.root, point.executor)
    : platformVerdict(entry, sources.platform);
}

/**
 * Check every enforcement point a register claims.
 * @param register - The control register
 * @param sources - What the points are checked against
 * @returns One row per point, in register order
 */
export async function reconcilePoints(
  register: ControlRegister,
  sources: PointSources
): Promise<readonly ReconciledPoint[]> {
  const rows = register.entries.flatMap(entry =>
    entry.enforcement_points.map(point => ({ entry, point }))
  );
  const verdicts = await Promise.all(
    rows.map(({ entry, point }) => verdictFor(entry, point, sources))
  );
  return rows.map(({ entry, point }, index) => ({
    entry_id: entry.id,
    gate: entry.gate,
    level: point.level,
    location: point.location,
    moment: point.moment,
    scope: entry.scope,
    ...(verdicts[index] ?? {
      checked: null,
      reason: NOBODY_ANSWERS[point.location](point.moment),
      state: "not-verifiable",
    }),
  }));
}
