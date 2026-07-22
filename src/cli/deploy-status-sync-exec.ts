/**
 * Execution layer for the deploy-status-sync engine (DSS-2): per-item state
 * fetching, planned-action execution, and no-op reporting. Split from
 * `deploy-status-sync-engine` so the context/orchestration and the
 * write-execution concerns each stay within the max-lines budget; the
 * engine composes these pieces and owns the run lifecycle.
 * @module cli/deploy-status-sync-exec
 */
import type {
  ItemAction,
  TrackerItemState,
  TransitionPlan,
} from "../core/deploy-status-transition.js";
import type { TrackerAdapter } from "./deploy-status-adapter.js";

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

/** Output sinks bound to the run's json mode. */
export interface Sinks {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
  readonly human: (message: string) => void;
}

/** One executed (or attempted) item outcome. */
export interface ItemResult {
  readonly ref: string;
  readonly outcome:
    | "promoted"
    | "skipped-at-or-beyond"
    | "skipped-container"
    | "skipped-unrecognized-status"
    | "failed";
  readonly detail?: string;
}

/**
 * Fetch item states, tolerating per-item failures.
 * @param refs - Canonical refs
 * @param adapter - Tracker adapter
 * @returns Fetched states and per-ref failures
 */
export async function fetchStates(
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
export async function executePlan(
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
 * Report an explanatory no-op on both channels: the human line always, plus
 * the machine payload in json mode — json consumers must receive parseable
 * output on EVERY exit path, not only when a plan executed.
 * @param sinks - Output sinks
 * @param options - CLI options (json mode)
 * @param plan - The no-op plan
 */
export function emitNoOp(
  sinks: Sinks,
  options: DeployStatusSyncOptions,
  plan: Extract<TransitionPlan, { kind: "no-op" }>
): void {
  sinks.human(plan.reason);
  if (options.json === true) {
    sinks.log(JSON.stringify({ env: plan.env, plan, results: [] }, null, 2));
  }
}
