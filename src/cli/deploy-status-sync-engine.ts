/**
 * Deploy-status-sync engine internals (DSS-2): context resolution, ref
 * extraction scoping, state fetching, and plan execution. The thin
 * `deploy-status-sync-cmd` entry point validates CLI inputs and delegates
 * here; tests drive the same seams through injectable dependencies.
 * @module cli/deploy-status-sync-engine
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  resolveDeployLadder,
  type DeployLadder,
  type Tracker,
} from "../core/deploy-status-sync.js";
import {
  planTransitions,
  type ItemAction,
  type TrackerItemState,
  type TransitionPlan,
} from "../core/deploy-status-transition.js";
import { getAtPath, isJsonObject, type JsonValue } from "../sync/json-path.js";
import {
  createTrackerAdapter,
  withDryRun,
  type TrackerAdapter,
  type TrackerAdapterOptions,
} from "./deploy-status-adapter.js";
import {
  extractWorkItemRefs,
  type ExtractedRefs,
  type ExtractRefsOptions,
} from "./deploy-status-refs.js";

/** CLI options for the deploy-status-sync engine. */
export interface DeployStatusSyncOptions {
  /** Environment the deploy landed in (exclusive with `branch`) */
  readonly environment?: string;
  /** Deployed branch, reverse-mapped to an env (exclusive with `environment`) */
  readonly branch?: string;
  /** Commit range as `base..head` */
  readonly range?: string;
  /** Range base SHA (used with `after`) */
  readonly before?: string;
  /** Range head SHA (used with `before`) */
  readonly after?: string;
  /** Plan and print without any tracker writes */
  readonly dryRun?: boolean;
  /** Emit the machine-readable plan/result JSON */
  readonly json?: boolean;
  /** Config path (default `.lisa.config.json` in the working directory) */
  readonly config?: string;
}

/** Injectable collaborators for the engine. */
export interface DeployStatusSyncDependencies {
  /** Working directory (defaults to the process cwd) */
  readonly cwd?: string;
  /** Output sink (defaults to stdout) */
  readonly log?: (message: string) => void;
  /** Error sink (defaults to stderr) */
  readonly error?: (message: string) => void;
  /** Ref extractor (defaults to the real git/gh extractor) */
  readonly extractRefs?: (
    options: ExtractRefsOptions
  ) => Promise<ExtractedRefs>;
  /** Adapter factory (defaults to {@link createTrackerAdapter}) */
  readonly adapterFactory?: (options: TrackerAdapterOptions) => TrackerAdapter;
}

/** Output sinks bound to the run's json mode. */
export interface Sinks {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
  readonly human: (message: string) => void;
}

/** Resolved run context shared by the engine stages. */
export interface RunContext {
  readonly config: JsonValue;
  readonly tracker: Tracker;
  readonly ladder: DeployLadder;
  readonly env: string;
  readonly branch: string;
}

/** One executed (or attempted) item outcome. */
interface ItemResult {
  readonly ref: string;
  readonly outcome:
    | "promoted"
    | "skipped-at-or-beyond"
    | "skipped-container"
    | "skipped-unrecognized-status"
    | "failed";
  readonly detail?: string;
}

const VALID_TRACKERS = new Set<string>(["github", "jira", "linear"]);

/**
 * Resolve the target environment from an explicit flag or the deployed
 * branch via the ladder (raw `deploy.branches` catches skipped rungs so the
 * planner can explain the missing done-map key).
 * @param options - CLI options
 * @param ladder - Resolved deploy ladder
 * @param config - Parsed config
 * @returns The environment name, or an error message
 */
function resolveEnvironment(
  options: DeployStatusSyncOptions,
  ladder: DeployLadder,
  config: JsonValue
): { readonly env: string } | { readonly problem: string } {
  if (options.environment !== undefined) return { env: options.environment };
  const branch = options.branch ?? "";
  const matching = ladder.rungs.filter(rung => rung.branch === branch);
  const envs = [...new Set(matching.map(rung => rung.env))];
  if (envs.length === 1 && envs[0] !== undefined) return { env: envs[0] };
  if (envs.length > 1) {
    return {
      problem: `Branch "${branch}" deploys to multiple environments (${envs.join(", ")}); pass --environment to disambiguate.`,
    };
  }
  const branches = getAtPath(config, "deploy.branches");
  const rawEnv = isJsonObject(branches)
    ? Object.keys(branches).find(env => branches[env] === branch)
    : undefined;
  if (rawEnv !== undefined) return { env: rawEnv };
  return {
    problem: `Branch "${branch}" is not a value of deploy.branches in .lisa.config.json.`,
  };
}

/**
 * Read the config and resolve the tracker, ladder, and environment.
 * @param options - CLI options
 * @param cwd - Working directory
 * @returns Run context, or a decision-ready problem
 */
export async function resolveRunContext(
  options: DeployStatusSyncOptions,
  cwd: string
): Promise<RunContext | { readonly problem: string }> {
  const configPath = path.resolve(cwd, options.config ?? ".lisa.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as JsonValue;
  const tracker = getAtPath(config, "tracker");
  if (typeof tracker !== "string" || !VALID_TRACKERS.has(tracker)) {
    return {
      problem:
        "'tracker' is not set in .lisa.config.json. Run /lisa:setup:jira (or :github, :linear) to configure.",
    };
  }
  const ladder = resolveDeployLadder(config, tracker as Tracker, configPath);
  const resolvedEnv = resolveEnvironment(options, ladder, config);
  if ("problem" in resolvedEnv) return resolvedEnv;
  const env = resolvedEnv.env;
  return {
    config,
    tracker: tracker as Tracker,
    ladder,
    env,
    branch:
      options.branch ??
      ladder.rungs.find(rung => rung.env === env)?.branch ??
      env,
  };
}

/**
 * Extract the work-item refs for the run's tracker scope.
 * @param context - Resolved run context
 * @param range - Normalized commit range
 * @param cwd - Working directory
 * @param deps - Injectable collaborators
 * @returns Extraction result
 */
function extractRefsForRun(
  context: RunContext,
  range: string,
  cwd: string,
  deps: DeployStatusSyncDependencies
): Promise<ExtractedRefs> {
  const org = getAtPath(context.config, "github.org");
  const repo = getAtPath(context.config, "github.repo");
  const repository =
    typeof org === "string" && typeof repo === "string"
      ? `${org}/${repo}`
      : undefined;
  const projectKey = getAtPath(
    context.config,
    context.tracker === "jira" ? "jira.project" : "linear.teamKey"
  );
  return (deps.extractRefs ?? extractWorkItemRefs)({
    range,
    tracker: context.tracker,
    ...(repository === undefined ? {} : { repository }),
    ...(typeof projectKey === "string" ? { projectKey } : {}),
    cwd,
  });
}

/**
 * Fetch item states, tolerating per-item failures.
 * @param refs - Canonical refs
 * @param adapter - Tracker adapter
 * @returns Fetched states and per-ref failures
 */
async function fetchStates(
  refs: readonly string[],
  adapter: TrackerAdapter
): Promise<{
  readonly items: readonly TrackerItemState[];
  readonly failures: readonly ItemResult[];
}> {
  const settled = await Promise.all(
    refs.map(async ref => {
      try {
        return { state: await adapter.fetchItemState(ref) };
      } catch (cause) {
        return {
          failure: {
            ref,
            outcome: "failed" as const,
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }
    })
  );
  return {
    items: settled.flatMap(entry =>
      "state" in entry && entry.state !== undefined ? [entry.state] : []
    ),
    failures: settled.flatMap(entry =>
      "failure" in entry && entry.failure !== undefined ? [entry.failure] : []
    ),
  };
}

/**
 * Execute one planned action through the adapter.
 * @param action - Planned item action
 * @param adapter - Tracker adapter (possibly dry-run wrapped)
 * @param log - Output sink
 * @returns The item outcome
 */
async function executeAction(
  action: ItemAction,
  adapter: TrackerAdapter,
  log: (message: string) => void
): Promise<ItemResult> {
  if (action.kind === "promote") {
    // Comment FIRST: the upsert is idempotent (byte-identical body →
    // `unchanged`), so any partial-failure prefix — comment ok + transition
    // failed, or transition ok + close failed — heals on retry. Transition
    // or closure first would strand evidence-less state changes.
    await adapter.upsertManagedComment(action.ref, action.commentBody);
    await adapter.transitionToDone(action.ref, action.doneStatus);
    if (action.close) await adapter.closeNatively(action.ref);
    log(
      `promoted ${action.ref} → ${action.doneStatus}${action.close ? " (closed natively)" : ""}`
    );
    return { ref: action.ref, outcome: "promoted", detail: action.doneStatus };
  }
  if (action.kind === "skip-container") {
    await adapter.upsertManagedComment(action.ref, action.commentBody);
    log(`skipped ${action.ref} (container, leaf-only-lifecycle)`);
    return { ref: action.ref, outcome: "skipped-container" };
  }
  const outcome =
    action.kind === "skip-at-or-beyond"
      ? ("skipped-at-or-beyond" as const)
      : ("skipped-unrecognized-status" as const);
  log(`skipped ${action.ref} (${action.reason})`);
  return { ref: action.ref, outcome, detail: action.reason };
}

/**
 * Execute the planned actions, tolerating per-item failures.
 * @param plan - Per-item action plan
 * @param adapter - Tracker adapter (possibly dry-run wrapped)
 * @param sinks - Output sinks
 * @returns Item results including failures
 */
async function executePlan(
  plan: Extract<TransitionPlan, { kind: "plan" }>,
  adapter: TrackerAdapter,
  sinks: Sinks
): Promise<readonly ItemResult[]> {
  return Promise.all(
    plan.actions.map(async action => {
      try {
        return await executeAction(action, adapter, sinks.human);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        sinks.error(`failed ${action.ref}: ${detail}`);
        return { ref: action.ref, outcome: "failed" as const, detail };
      }
    })
  );
}

/**
 * Fetch states, plan, and execute for the extracted refs.
 * @param context - Resolved run context
 * @param extracted - Extraction result
 * @param options - CLI options
 * @param deps - Injectable collaborators
 * @param sinks - Output sinks
 * @returns Intended process exit code
 */
async function runPlanned(
  context: RunContext,
  extracted: ExtractedRefs,
  options: DeployStatusSyncOptions,
  deps: DeployStatusSyncDependencies,
  sinks: Sinks
): Promise<number> {
  const base = (deps.adapterFactory ?? createTrackerAdapter)({
    tracker: context.tracker,
    config: context.config,
    doneStatuses: context.ladder.rungs.map(rung => rung.doneStatus),
    cwd: deps.cwd ?? process.cwd(),
  });
  const adapter =
    options.dryRun === true
      ? withDryRun(base, write => {
          sinks.human(`dry-run: would ${write.method} ${write.ref}`);
        })
      : base;
  const fetched = await fetchStates(extracted.refs, adapter);
  const plan = planTransitions({
    ladder: context.ladder,
    env: context.env,
    tracker: context.tracker,
    branch: context.branch,
    headSha: extracted.headSha,
    items: fetched.items,
  });
  if (fetched.failures.length > 0) {
    fetched.failures.forEach(failure => {
      sinks.error(`failed ${failure.ref}: ${failure.detail ?? ""}`);
    });
  }
  if (plan.kind === "no-op") {
    sinks.human(plan.reason);
    return fetched.failures.length > 0 ? 1 : 0;
  }
  const results = await executePlan(plan, adapter, sinks);
  const allResults = [...fetched.failures, ...results];
  if (options.json === true) {
    sinks.log(
      JSON.stringify({ env: context.env, plan, results: allResults }, null, 2)
    );
  }
  sinks.human(
    `deploy-status-sync: ${String(allResults.length)} item(s) processed for ${context.env}${options.dryRun === true ? " (dry-run)" : ""}`
  );
  return allResults.some(result => result.outcome === "failed") ? 1 : 0;
}

/**
 * Run the engine over a resolved context: preflight the environment (an
 * unconfigured env is an explanatory no-op, exit 0), extract refs, then
 * fetch/plan/execute.
 * @param context - Resolved run context
 * @param range - Normalized commit range
 * @param options - CLI options
 * @param deps - Injectable collaborators
 * @param sinks - Output sinks
 * @returns Intended process exit code
 */
export async function runResolved(
  context: RunContext,
  range: string,
  options: DeployStatusSyncOptions,
  deps: DeployStatusSyncDependencies,
  sinks: Sinks
): Promise<number> {
  const preflight = planTransitions({
    ladder: context.ladder,
    env: context.env,
    tracker: context.tracker,
    branch: context.branch,
    headSha: "",
    items: [],
  });
  if (preflight.kind === "no-op") {
    sinks.human(preflight.reason);
    return 0;
  }
  const extracted = await extractRefsForRun(
    context,
    range,
    deps.cwd ?? process.cwd(),
    deps
  );
  extracted.skipped.forEach(entry => {
    sinks.human(`skipped token ${entry.token} (${entry.reason})`);
  });
  if (extracted.refs.length === 0) {
    sinks.human(`no work-item refs found in ${range}`);
    return 0;
  }
  return runPlanned(context, extracted, options, deps, sinks);
}
