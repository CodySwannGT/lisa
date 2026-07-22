/**
 * Pure transition planner for deploy-status-sync (DSS-2).
 *
 * Given the resolved deploy ladder, a target environment, and the fetched
 * tracker item states, decide — with zero IO — what should happen to each
 * item: promote to the rung's done status (closing natively only at the
 * universe's terminal env), skip items at-or-beyond the rung (never moving
 * anything backward), skip containers per `leaf-only-lifecycle`, and turn an
 * unconfigured environment into an explanatory no-op naming the exact
 * missing config key. All status vocabulary is config-sourced via the DSS-1
 * resolver's ladder; this module never invents status names.
 * @module core/deploy-status-transition
 */
import {
  doneMapPath,
  type DeployLadder,
  type DeployLadderRung,
  type Tracker,
} from "./deploy-status-sync.js";

/** Marker prefixing every managed comment the engine writes. */
export const DEPLOY_STATUS_SYNC_MARKER = "[lisa-deploy-status-sync]";

/** Vendor-neutral snapshot of one tracker item, fetched by an adapter. */
export interface TrackerItemState {
  /** Canonical work-item ref (`owner/repo#N` or `KEY-N`) */
  readonly ref: string;
  /** Raw item type (e.g. `Epic`, `type:Story`), when the tracker exposes it */
  readonly type?: string;
  /** Number of child items not yet terminal */
  readonly openChildren: number;
  /** Current status within the configured done vocabulary, when recognizable */
  readonly currentStatus?: string;
  /** True when the item is natively closed/terminal */
  readonly closed: boolean;
}

/** Promote one leaf to the rung's done status (and optionally close). */
export interface PromoteAction {
  readonly kind: "promote";
  readonly ref: string;
  /** Config-sourced done status of the target rung */
  readonly doneStatus: string;
  /** True only at the universe's terminal env (native closure) */
  readonly close: boolean;
  /** Deterministic managed-comment body (marker-prefixed, no timestamps) */
  readonly commentBody: string;
}

/** Skip an item already at-or-beyond the target rung — zero writes. */
export interface SkipAtOrBeyondAction {
  readonly kind: "skip-at-or-beyond";
  readonly ref: string;
  readonly reason: string;
}

/** Skip a container per leaf-only-lifecycle, with a rollup comment. */
export interface SkipContainerAction {
  readonly kind: "skip-container";
  readonly ref: string;
  readonly reason: string;
  /** Deterministic rollup body (identical across env events) */
  readonly commentBody: string;
}

/** Skip a closed item whose status is outside the config vocabulary. */
export interface SkipUnrecognizedStatusAction {
  readonly kind: "skip-unrecognized-status";
  readonly ref: string;
  readonly reason: string;
}

/** One planned action for one extracted work-item ref. */
export type ItemAction =
  | PromoteAction
  | SkipAtOrBeyondAction
  | SkipContainerAction
  | SkipUnrecognizedStatusAction;

/** Input to {@link planTransitions}. */
export interface TransitionPlanInput {
  /** Resolved ladder from the DSS-1 resolver (config-sourced vocabulary) */
  readonly ladder: DeployLadder;
  /** Environment the deploy landed in */
  readonly env: string;
  /** Tracker vendor (names the done-map config key in no-ops) */
  readonly tracker: Tracker;
  /** Branch that deployed (comment context only) */
  readonly branch: string;
  /** Head SHA of the deployed range (comment context only) */
  readonly headSha: string;
  /** Fetched item states for every extracted ref */
  readonly items: readonly TrackerItemState[];
}

/** The full plan: either per-item actions or an explanatory no-op. */
export type TransitionPlan =
  | {
      readonly kind: "no-op";
      readonly env: string;
      /** Operator-readable explanation naming the missing config key */
      readonly reason: string;
    }
  | {
      readonly kind: "plan";
      readonly env: string;
      readonly rung: DeployLadderRung;
      readonly actions: readonly ItemAction[];
    };

const PROD_SPELLINGS = new Set(["prod", "production"]);

/**
 * Find the ladder rung for an environment, honoring the sole
 * `prod` ↔ `production` alias (a ladder built from `branches.prod` may be
 * addressed as `production` and vice versa).
 * @param ladder - Resolved deploy ladder
 * @param env - Requested environment name
 * @returns The matching rung, or undefined when unconfigured
 */
function findRung(
  ladder: DeployLadder,
  env: string
): DeployLadderRung | undefined {
  const exact = ladder.rungs.find(rung => rung.env === env);
  if (exact !== undefined || !PROD_SPELLINGS.has(env)) return exact;
  return ladder.rungs.find(rung => PROD_SPELLINGS.has(rung.env));
}

/**
 * Build the deterministic promotion comment body. No timestamps — a re-run
 * of the same event must produce a byte-identical body so the managed
 * comment upsert resolves to `unchanged` with zero edit calls.
 * @param input - Planner input (env, branch, head)
 * @param rung - Target rung
 * @param close - Whether terminal closure applies
 * @returns Marker-prefixed comment body
 */
function promotionBody(
  input: TransitionPlanInput,
  rung: DeployLadderRung,
  close: boolean
): string {
  const closure = close
    ? "\nTerminal environment reached; item closed natively (leaf-only-lifecycle)."
    : "";
  return `${DEPLOY_STATUS_SYNC_MARKER}\nDeploy status sync: "${input.env}" deploy of branch "${input.branch}" (head ${input.headSha}) → "${rung.doneStatus}".${closure}`;
}

/** Deterministic rollup body for skipped containers (env-independent). */
const CONTAINER_ROLLUP_BODY = `${DEPLOY_STATUS_SYNC_MARKER}\nRollup: container skipped per leaf-only-lifecycle — containers are never transitioned by deploy events; leaf items advance individually.`;

/**
 * Whether an item is a container (epic-typed or has open children), per the
 * assertLeaf semantics of the work-item contract.
 * @param item - Fetched item state
 * @returns True when the item must not be transitioned
 */
function isContainer(item: TrackerItemState): boolean {
  const normalizedType = (item.type ?? "")
    .replace(/^type:/i, "")
    .trim()
    .toLowerCase();
  return normalizedType === "epic" || item.openChildren > 0;
}

/**
 * Plan the action for one item against the target rung.
 * @param item - Fetched item state
 * @param input - Planner input
 * @param rung - Target rung
 * @param close - Whether terminal closure applies at this rung
 * @param doneStatuses - Ladder done statuses, lowest rung first
 * @returns The planned action
 */
function planItem(
  item: TrackerItemState,
  input: TransitionPlanInput,
  rung: DeployLadderRung,
  close: boolean,
  doneStatuses: readonly string[]
): ItemAction {
  if (isContainer(item)) {
    return {
      kind: "skip-container",
      ref: item.ref,
      reason: `container (type "${item.type ?? "unknown"}", ${String(item.openChildren)} open children) skipped per leaf-only-lifecycle`,
      commentBody: CONTAINER_ROLLUP_BODY,
    };
  }
  const currentIndex =
    item.currentStatus === undefined
      ? -1
      : doneStatuses.indexOf(item.currentStatus);
  if (item.closed) {
    if (currentIndex === -1) {
      return {
        kind: "skip-unrecognized-status",
        ref: item.ref,
        reason: `closed at status "${item.currentStatus ?? "(none)"}", which is outside the configured ${doneMapPath(input.tracker)} vocabulary; not moving (config-bound vocabulary)`,
      };
    }
    return {
      kind: "skip-at-or-beyond",
      ref: item.ref,
      reason: `already closed at "${item.currentStatus ?? ""}"`,
    };
  }
  const targetIndex = doneStatuses.indexOf(rung.doneStatus);
  if (currentIndex >= targetIndex) {
    return {
      kind: "skip-at-or-beyond",
      ref: item.ref,
      reason: `current status "${item.currentStatus ?? ""}" is at or beyond "${rung.doneStatus}"`,
    };
  }
  return {
    kind: "promote",
    ref: item.ref,
    doneStatus: rung.doneStatus,
    close,
    commentBody: promotionBody(input, rung, close),
  };
}

/**
 * Plan all transitions for a deploy event. Pure — performs no IO; callers
 * fetch item states through an adapter and execute the returned actions.
 * @param input - Ladder, env, tracker, range context, and item states
 * @returns Explanatory no-op or per-item action plan
 */
export function planTransitions(input: TransitionPlanInput): TransitionPlan {
  const rung = findRung(input.ladder, input.env);
  if (rung === undefined) {
    return {
      kind: "no-op",
      env: input.env,
      reason: `no-op: environment "${input.env}" has no configured done status — .lisa.config.json is missing ${doneMapPath(input.tracker)}.${input.env}. No transitions attempted.`,
    };
  }
  const close =
    input.ladder.terminalEnv !== undefined &&
    rung.env === input.ladder.terminalEnv;
  const doneStatuses = input.ladder.rungs.map(entry => entry.doneStatus);
  const actions = input.items.map(item =>
    planItem(item, input, rung, close, doneStatuses)
  );
  return { kind: "plan", env: input.env, rung, actions };
}
