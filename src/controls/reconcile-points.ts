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
 * | The coding agent (edit time) | The carrier check and recorded registrations | Whether each installed agent's local hook starts the carrier |
 * | The hosting platform, pipeline written by the host | The file the register names | Whether it is there and runs the runner's pull-request command, as text |
 * | The hosting platform, GitHub | The platform's merge settings, when asked | Whether the entry's checks are required before a merge |
 * | A deployment pipeline, a scheduled run | Nobody | Not verifiable by this command |
 *
 * The edit-time verdict accounts for every recorded agent. Other carrier
 * points match by location and moment.
 * @module controls/reconcile-points
 */
import {
  AGENT_CONFIG,
  type CarrierPoint,
  type CarrierResult,
} from "./carrier-types.js";
import { EDIT_TIME_MOMENT, type CodingAgent } from "./coding-agents.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import {
  carrierVerdict,
  type ShownFileReader,
} from "./reconcile-carrier-points.js";
import { executorVerdict } from "./reconcile-executor.js";
import { platformVerdict, type PlatformRead } from "./reconcile-platform.js";
import type {
  AgentVerdict,
  PointVerdict,
  ReconciledPoint,
} from "./reconcile-types.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
  EnforcementLocation,
  EnforcementPoint,
} from "./register-types.js";

/** The verdict for a point the current checkout cannot establish. */
const NOT_VERIFIABLE = "not-verifiable";

/** Everything the points are checked against. */
export interface PointSources {
  /** Real path of the repository. */
  readonly root: string;
  /** The result of the carrier check of this checkout. */
  readonly carriers: CarrierResult;
  /** Whether the carrier record lists the shared edit-time hook. */
  readonly agentCarrier?: boolean;
  /** Registered settings that still run Lisa's carrier for edits. */
  readonly registrations?: ReadonlySet<CodingAgent>;
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

/** Human-readable names used when an agent's registration needs attention. */
const AGENT_NAME: Readonly<Record<CodingAgent, string>> = {
  agy: "Antigravity",
  claude: "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  devin: "Devin",
  opencode: "OpenCode",
};

/**
 * Check the carrier and one agent's registration as it currently stands.
 * @param carried - The point returned by the carrier check
 * @param agent - The recorded agent
 * @param sources - What was read in the checkout
 * @returns The state and reason for this agent
 */
async function editTimeAgent(
  carried: CarrierPoint,
  agent: CodingAgent,
  sources: PointSources
): Promise<AgentVerdict> {
  const verdict = await carrierVerdict(carried, sources.carriers, sources.read);
  const changedRegistration =
    verdict.state === "wired" &&
    carried.outcome === "updated" &&
    sources.carriers.changes.some(change => change.path === carried.path) &&
    sources.registrations?.has(agent) !== true;
  return changedRegistration
    ? {
        agent,
        checked: carried.path,
        state: "not-wired",
        reason: `${AGENT_NAME[agent]} no longer has a registration in ${carried.path ?? "its hook settings"} that runs Lisa's edit-time carrier.`,
      }
    : { ...verdict, agent, reason: `${AGENT_NAME[agent]} — ${verdict.reason}` };
}

/**
 * Confirm every recorded agent that can enforce this point.
 * @param point - The point in the control register
 * @param sources - What was read in the checkout
 * @returns The point verdict and each individual agent verdict
 */
async function editTimeVerdict(
  point: EnforcementPoint,
  sources: PointSources
): Promise<PointVerdict> {
  const checks = sources.carriers.enforcement_points.flatMap(carried => {
    const { agent } = carried;
    return carried.wired_through === AGENT_CONFIG &&
      carried.moment === point.moment &&
      agent !== undefined &&
      point.unenforceable_on?.includes(agent) !== true
      ? [editTimeAgent(carried, agent, sources)]
      : [];
  });
  if (checks.length === 0) {
    return {
      checked: null,
      reason:
        sources.agentCarrier === true
          ? 'The installed edit-time carrier has no recorded coding agents for this point. Run "lisa controls install-carriers --agents" again to record them.'
          : "No edit-time agent carrier is recorded as installed in this checkout.",
      state: NOT_VERIFIABLE,
    };
  }
  const agents = await Promise.all(checks);
  const failed = agents.filter(agent => agent.state === "not-wired");
  const reported = failed.length > 0 ? failed : agents;
  return {
    agent_verdicts: agents,
    checked: reported.length === 1 ? (reported[0]?.checked ?? null) : null,
    reason: reported.map(agent => agent.reason).join(" "),
    state: failed.length > 0 ? "not-wired" : "wired",
  };
}

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
  if (point.location === "coding-agent" && point.moment === EDIT_TIME_MOMENT) {
    return editTimeVerdict(point, sources);
  }
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
      state: NOT_VERIFIABLE,
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
    ...(point.unenforceable_on === undefined
      ? {}
      : { unenforceable_on: point.unenforceable_on }),
    ...(verdicts[index] ?? {
      checked: null,
      reason: NOBODY_ANSWERS[point.location](point.moment),
      state: NOT_VERIFIABLE,
    }),
  }));
}
