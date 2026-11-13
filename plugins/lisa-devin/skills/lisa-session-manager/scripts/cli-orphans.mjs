/**
 * `orphan-plan`: the session manager's per-cycle "Orphans and holds" sweep
 * (CodySwannGT/lisa#4722). The plan writes nothing: the manager finishes,
 * returns, re-dispatches or parks each orphan and lifts or keeps each hold
 * through `lisa-tracker-write`, as the skill says.
 *
 * Who the manager is and who may release a hold come from the ledger and
 * config only, never from the input: the input is assembled from items'
 * own (untrusted) bodies and comments, so ids carried beside them would let
 * an item vouch for itself, and a live ref an input could drop would let the
 * sweep return an item a worker is still on.
 *
 * Item bodies and comments arrive on stdin or in a file, never in argv.
 * @module session-manager/cli-orphans
 */
import {
  readPath,
  resolveRole,
} from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  CliError,
  asSetupError,
  humanNeededLabel,
  intFlag,
  loadProject,
  stdinText,
  validOrAbsent,
} from "./cli-runtime.mjs";
import { parseJson, readJsonFile } from "./json-input.mjs";
import { readLedger } from "./ledger.mjs";
import { planOrphanSweep } from "./orphan-sweep.mjs";

/** The roles whose labels count as "in a lane" for a hold release. */
const LANE_ROLES = ["ready", "claimed", "blocked", "review", "human_needed"];

/** Ledger statuses that mean a worker is on the item, or a person is asked. */
const LIVE_STATUSES = new Set(["running", "question"]);

/**
 * The tracker this project uses.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {string | undefined} `github`, `jira` or `linear`
 */
const trackerOf = project => project.local?.tracker ?? project.global?.tracker;

/**
 * One lifecycle role's configured value, empty when unset.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @param {string} name - Role name
 * @returns {string} Label or state
 */
function roleValue(project, name) {
  return resolveRole({
    role: name,
    vendor: trackerOf(project),
    local: project.local,
    global: project.global,
  }).value;
}

/**
 * Every configured `done` value: the env-keyed map's values, or one string.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {string[]} Done labels or states
 */
function doneValues(project) {
  const roots = { jira: "jira.workflow", linear: "linear.workflow" };
  const root = roots[trackerOf(project)] ?? "github.labels.build";
  for (const config of [project.local, project.global]) {
    const done = readPath(config, `${root}.done`);
    if (typeof done === "string" && done !== "") return [done];
    if (done && typeof done === "object") {
      return Object.values(done).filter(value => typeof value === "string");
    }
  }
  return [];
}

/**
 * The hold policy from config: labels, lanes and human-only classes.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {object} Policy fields for planOrphanSweep
 */
function holdPolicy(project) {
  const humanOnly =
    readPath(project.local, "humanGate.humanOnly") ??
    readPath(project.global, "humanGate.humanOnly");
  return {
    humanNeededLabel: humanNeededLabel(project, undefined),
    humanOnly,
    readyLabel: roleValue(project, "ready"),
    // A hold's role is its lane: on Jira and Linear the lane is a state, so
    // the lift's lane check reads it as one more label.
    roleLabels: Object.fromEntries(
      LANE_ROLES.map(name => [name, roleValue(project, name)]).filter(
        ([, value]) => value !== ""
      )
    ),
    lifecycleLabels: [
      ...LANE_ROLES.map(name => roleValue(project, name)),
      ...doneValues(project),
    ].filter(value => value !== ""),
  };
}

/**
 * Read the envelope and refuse one not paged to completion.
 * @param {object} ctx - CLI context
 * @returns {{items: unknown, holds: unknown}} The listed items and holds
 */
function readEnvelope(ctx) {
  const envelope = ctx.values.input
    ? readJsonFile(ctx.values.input)
    : parseJson(stdinText(ctx, "orphan JSON"), "stdin");
  if (envelope?.complete !== true) {
    throw new CliError(
      "The orphan listing was not paged to completion (complete !== true); " +
        "refusing to plan from a partial list.",
      2
    );
  }
  return { items: envelope.items, holds: envelope.holds };
}

/**
 * `orphan-plan [--input <file>] [--max <n>] [--stale-hours <n>]` (stdin
 * without --input: `{"complete":true,"items":[...],"holds":[...]}`).
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} The plan from planOrphanSweep
 */
export async function orphanPlan(ctx) {
  const input = readEnvelope(ctx);
  const max = intFlag(ctx.values.max, "--max");
  const staleHours = intFlag(ctx.values["stale-hours"], "--stale-hours");
  const project = loadProject(ctx.root);
  const config = validOrAbsent(project);
  const ledger = await readLedger(ctx.root);
  const liveRefs = Object.entries(ledger.items)
    .filter(([, item]) => LIVE_STATUSES.has(item.status))
    .map(([ref]) => ref);
  return {
    json: asSetupError(() =>
      planOrphanSweep(input, {
        liveRefs,
        me: ledger.control.me ?? null,
        operatorIds: config?.operatorIds ?? [],
        trustedAuthorIds: config?.trustedAuthorIds ?? [],
        now: new Date(),
        ...(max === undefined ? {} : { max }),
        ...(staleHours === undefined ? {} : { staleHours }),
        previousDigest: ledger.control.holdDigest ?? null,
        ...holdPolicy(project),
      })
    ),
  };
}
