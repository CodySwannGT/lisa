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
import { runKaneCommand } from "../core/kane-cli-process.js";
import type { Tracker } from "../core/deploy-status-sync.js";
import type { TrackerItemState } from "../core/deploy-status-transition.js";
import { getAtPath, type JsonValue } from "../sync/json-path.js";
import { createGithubAdapter } from "./deploy-status-adapter-github.js";
import { createJiraAdapter } from "./deploy-status-adapter-jira.js";
import { createLinearAdapter } from "./deploy-status-adapter-linear.js";
import { getProcessEnv } from "./update-check.js";

/** Result of a managed-comment upsert. */
export type CommentUpsertResult = "created" | "updated" | "unchanged";

/** Vendor adapter: dumb fetch/mutate over one tracker. */
export interface TrackerAdapter {
  /** Fetch the vendor-neutral state snapshot for one item. */
  readonly fetchItemState: (ref: string) => Promise<TrackerItemState>;
  /** Move the item to the given config-sourced done status. */
  readonly transitionToDone: (ref: string, doneStatus: string) => Promise<void>;
  /** Find-or-update the single marker-managed comment on the item. */
  readonly upsertManagedComment: (
    ref: string,
    body: string
  ) => Promise<CommentUpsertResult>;
  /** Close the item natively (terminal rung only; may be a vendor no-op). */
  readonly closeNatively: (ref: string) => Promise<void>;
}

/** Executes `gh` without a shell and returns stdout. */
export type ExecGh = (args: readonly string[]) => Promise<string>;

/** Injectable collaborators for {@link createTrackerAdapter}. */
export interface TrackerAdapterDeps {
  /** gh executor (defaults to the runner from {@link createExecGh}) */
  readonly execGh?: ExecGh;
  /** Fetch implementation for Linear/Jira (defaults to global fetch) */
  readonly fetchImpl?: typeof fetch;
  /** Environment for credential sourcing (defaults to the process env) */
  readonly env?: Record<string, string | undefined>;
  /** Secret reader for the darwin keychain fallback */
  readonly readSecret?: (
    service: string,
    account: string
  ) => Promise<string | undefined>;
}

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
 * Build a fixed-argv executor for one executable over the shared process
 * runner (no shell; credentials never appear in argv). Shared by the gh
 * adapter transport and the ref-extraction git/gh deps.
 * @param executable - Executable name resolved on PATH
 * @param cwd - Working directory
 * @param env - Optional environment override (tests point PATH at a fake)
 * @returns Fixed-argv executor returning stdout
 */
export function createExec(
  executable: string,
  cwd: string,
  env?: NodeJS.ProcessEnv
): (args: readonly string[]) => Promise<string> {
  return async args => {
    const result = await runKaneCommand(executable, [...args], {
      cwd,
      timeoutMs: 120_000,
      env: env ?? getProcessEnv(),
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${executable} ${args[0] ?? ""} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
      );
    }
    return result.stdout;
  };
}

/**
 * Build a gh executor (ambient gh auth).
 * @param cwd - Working directory
 * @param env - Optional environment override (tests point PATH at a fake)
 * @returns gh executor
 */
export function createExecGh(cwd: string, env?: NodeJS.ProcessEnv): ExecGh {
  return createExec("gh", cwd, env);
}

/**
 * Derive the vendor-neutral type and current status from an item's label
 * names — shared by the label-driven adapters (GitHub, Linear). The
 * highest-rung done label wins so at-or-beyond compares conservatively.
 * @param labels - Label names on the item
 * @param doneStatuses - Ladder done vocabulary, lowest rung first
 * @returns Optional type and currentStatus fields
 */
export function deriveLabelState(
  labels: readonly string[],
  doneStatuses: readonly string[]
): { readonly type?: string; readonly currentStatus?: string } {
  const type = labels.find(name => name.toLowerCase().startsWith("type:"));
  const currentStatus = [...doneStatuses]
    .reverse()
    .find(status => labels.includes(status));
  return {
    ...(type === undefined ? {} : { type }),
    ...(currentStatus === undefined ? {} : { currentStatus }),
  };
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
