/**
 * Vendor-neutral tracker adapter seam for the deploy-status-sync engine.
 *
 * Adapters are dumb fetch/mutate transports: leaf/container classification
 * and every policy decision live in the pure planner
 * (`core/deploy-status-transition.ts`). The dry-run wrapper is both the
 * production `--dry-run` implementation and the unit-test write recorder —
 * one seam, two uses — so "zero API writes" holds by construction.
 * @module cli/deploy-status-adapter
 */
import type { Tracker } from "../core/deploy-status-sync.js";
import { getAtPath, type JsonValue } from "../sync/json-path.js";
import { createGithubAdapter } from "./deploy-status-adapter-github.js";
import { createJiraAdapter } from "./deploy-status-adapter-jira.js";
import { createLinearAdapter } from "./deploy-status-adapter-linear.js";
import {
  createExecGh,
  type TrackerAdapter,
  type TrackerAdapterDeps,
} from "./deploy-status-adapter-shared.js";

// Shared adapter surface lives in the leaf contract module (cycle-free:
// the vendor adapters import it directly); re-exported here so downstream
// importers (engine, cmd, refs, tests) keep a single import site.
export {
  createExec,
  createExecGh,
  deriveLabelState,
} from "./deploy-status-adapter-shared.js";
export type {
  CommentUpsertResult,
  ExecGh,
  TrackerAdapter,
  TrackerAdapterDeps,
} from "./deploy-status-adapter-shared.js";

/** Construction options for {@link createTrackerAdapter}. */
export interface TrackerAdapterOptions {
  readonly tracker: Tracker;
  /** Parsed `.lisa.config.json` (vendor coordinates are read from it) */
  readonly config: JsonValue;
  /** Ladder done vocabulary, lowest rung first (config-sourced) */
  readonly doneStatuses: readonly string[];
  /** Working directory for gh */
  readonly cwd: string;
}

/**
 * Read a required string from config, failing decision-readably.
 * @param config - Parsed config
 * @param dotPath - Dot path of the key
 * @returns The configured string
 */
function requireConfigString(config: JsonValue, dotPath: string): string {
  const value = getAtPath(config, dotPath);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing ${dotPath} in .lisa.config.json — required to reach the configured tracker`
    );
  }
  return value;
}

/**
 * Read an optional string from config.
 * @param config - Parsed config
 * @param dotPath - Dot path of the key
 * @returns The configured string, or undefined
 */
function optionalConfigString(
  config: JsonValue,
  dotPath: string
): string | undefined {
  const value = getAtPath(config, dotPath);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Create the vendor adapter for the configured tracker.
 * @param options - Tracker, parsed config, done vocabulary, cwd
 * @param deps - Injectable transports (tests inject recorders)
 * @returns The vendor adapter
 */
export function createTrackerAdapter(
  options: TrackerAdapterOptions,
  deps: TrackerAdapterDeps = {}
): TrackerAdapter {
  const { tracker, config, doneStatuses, cwd } = options;
  if (tracker === "github") {
    const org = requireConfigString(config, "github.org");
    const repo = requireConfigString(config, "github.repo");
    return createGithubAdapter(
      { repository: `${org}/${repo}`, doneStatuses },
      { execGh: deps.execGh ?? createExecGh(cwd) }
    );
  }
  if (tracker === "linear") {
    return createLinearAdapter(
      {
        workspace: requireConfigString(config, "linear.workspace"),
        doneStatuses,
      },
      deps
    );
  }
  const cloudId = optionalConfigString(config, "atlassian.cloudId");
  const site = optionalConfigString(config, "atlassian.site");
  const email = optionalConfigString(config, "atlassian.email");
  return createJiraAdapter(
    {
      ...(cloudId === undefined ? {} : { cloudId }),
      ...(site === undefined ? {} : { site }),
      ...(email === undefined ? {} : { email }),
    },
    deps
  );
}

/** One suppressed write reported by the dry-run wrapper. */
export interface RecordedWrite {
  readonly method:
    | "transitionToDone"
    | "upsertManagedComment"
    | "closeNatively";
  readonly ref: string;
  readonly detail?: string;
}

/**
 * Wrap an adapter so reads pass through and writes are reported to the
 * caller but never executed. The caller owns accumulation (the CLI prints
 * planned writes as they occur; tests collect them), keeping this wrapper
 * stateless. Used for `--dry-run` and as the unit-test write recorder.
 * @param inner - Real adapter (only its reads are used)
 * @param onWrite - Sink invoked once per suppressed write, in call order
 * @returns Wrapped adapter with all writes suppressed
 */
export function withDryRun(
  inner: Pick<TrackerAdapter, "fetchItemState">,
  onWrite: (write: RecordedWrite) => void
): TrackerAdapter {
  return {
    fetchItemState: ref => inner.fetchItemState(ref),
    transitionToDone: (ref, doneStatus) => {
      onWrite({ method: "transitionToDone", ref, detail: doneStatus });
      return Promise.resolve();
    },
    upsertManagedComment: (ref, body) => {
      onWrite({ method: "upsertManagedComment", ref, detail: body });
      return Promise.resolve("created" as const);
    },
    closeNatively: ref => {
      onWrite({ method: "closeNatively", ref });
      return Promise.resolve();
    },
  };
}
