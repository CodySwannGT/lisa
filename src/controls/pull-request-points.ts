/**
 * The result of an entry's pull-request enforcement point, from what the
 * hosting platform's settings say.
 *
 * Reading a setting is not a proof. So a result made here is never `passed`:
 *
 * | the settings say | result | reason |
 * | --- | --- | --- |
 * | every check of the entry is required | `unproved` | `observed-required` |
 * | a check of the entry is not required | `failed` | `observed-not-required` |
 * | nothing, because they were not read | `unknown` | `merge-protection-unread`, `platform-not-reached` |
 *
 * `observed` on the result says the same thing as a single word, so a reader
 * does not have to decode the reason. Two more cases never reach the
 * settings: an entry the register does not ask the platform to enforce
 * (`not-asked-of-platform`), and one that reports no check on a pull request
 * (`no-check-derived`). Both are `unproved`.
 *
 * Every result here carries `rung: "observed"`.
 * @module controls/pull-request-points
 */
import { isProtectedEntry } from "./protect-derive.js";
import type { ProofEntryResult } from "./proof-types.js";
import type { Observation } from "./pull-request-observe.js";
import {
  PULL_REQUEST_POINT_MOMENT,
  type ObservedCheck,
  type ObservedState,
  type PullRequestPoint,
} from "./pull-request-types.js";
import {
  NO_CHECK_DETAIL,
  notAskedDetail,
  notRequiredDetail,
  requiredDetail,
  unreadDetail,
} from "./pull-request-wording.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** What deciding a point needs beside the entry. */
export interface PointContext {
  readonly observation: Observation;
  /** When the settings were read, in UTC. */
  readonly completedAt: string;
  /** Whether the entry is enforced at commit or push too. */
  readonly settlesEntry: boolean;
}

/**
 * Tell whether an entry is enforced on pull requests at all.
 * @param entry - A register entry
 * @returns Whether it has a pull-request enforcement point
 */
export function hasPullRequestPoint(entry: ControlRegisterEntry): boolean {
  return entry.enforcement_points.some(
    point => point.moment === PULL_REQUEST_POINT_MOMENT
  );
}

/**
 * Say what the settings show for an entry's checks.
 * @param checks - The entry's checks
 * @param required - The checks the platform requires, or `null` when unread
 * @returns Each check with its state
 */
function standing(
  checks: readonly string[],
  required: ReadonlySet<string> | null
): readonly ObservedCheck[] {
  return checks.map(context => {
    const held = required?.has(context) === true ? "required" : "not-required";
    return { context, state: required === null ? "unknown" : held };
  });
}

/**
 * Decide an entry's result from what was observed.
 * @param entry - The entry
 * @param observation - What the settings showed
 * @returns The parts of the result that depend on the observation
 */
function decide(
  entry: ControlRegisterEntry,
  observation: Observation
): Pick<ProofEntryResult, "outcome" | "reason" | "detail"> & {
  readonly observed: ObservedState;
  readonly checks: readonly ObservedCheck[];
} {
  if (!isProtectedEntry(entry)) {
    return {
      outcome: "unproved",
      reason: "not-asked-of-platform",
      detail: notAskedDetail(entry),
      observed: "not-asked",
      checks: [],
    };
  }
  const names = observation.checksOf(entry.id);
  if (names?.length === 0) {
    return {
      outcome: "unproved",
      reason: "no-check-derived",
      detail: NO_CHECK_DETAIL,
      observed: "not-asked",
      checks: [],
    };
  }
  const checks = standing(names ?? [], observation.required);
  if (observation.unread !== null || observation.required === null) {
    return {
      outcome: "unknown",
      reason: observation.unread?.reason ?? "merge-protection-unread",
      detail:
        observation.unread?.reason === "platform-not-reached"
          ? observation.unread.detail
          : unreadDetail(observation.unread?.detail ?? "no reason was given."),
      observed: "unknown",
      checks,
    };
  }
  const missing = checks
    .filter(check => check.state !== "required")
    .map(check => check.context);
  return missing.length === 0
    ? {
        outcome: "unproved",
        reason: "observed-required",
        detail: requiredDetail(names ?? [], observation.branch),
        observed: "required",
        checks,
      }
    : {
        outcome: "failed",
        reason: "observed-not-required",
        detail: notRequiredDetail(missing, observation.branch),
        observed: "not-required",
        checks,
      };
}

/**
 * The result of an entry's pull-request point at the `observed` rung.
 * @param entry - A register entry that is enforced on pull requests
 * @param context - What was observed, when, and whether this is the entry's
 *   one result
 * @returns The point's result
 */
export function observedPoint(
  entry: ControlRegisterEntry,
  context: PointContext
): PullRequestPoint {
  return {
    entry_id: entry.id,
    gate: entry.gate,
    scope: entry.scope,
    criteria: entry.criteria,
    moment: PULL_REQUEST_POINT_MOMENT,
    failed_halves: [],
    time_limit_seconds: null,
    halves: [],
    rung: "observed",
    settles_entry: context.settlesEntry,
    completed_at: context.completedAt,
    ...decide(entry, context.observation),
  };
}

/**
 * The entry result a point stands for, without the point's own fields.
 * @param point - The point's result
 * @returns What goes in the run's `entries`
 */
export function entryResultOf(point: PullRequestPoint): ProofEntryResult {
  return {
    entry_id: point.entry_id,
    gate: point.gate,
    scope: point.scope,
    criteria: point.criteria,
    moment: point.moment,
    outcome: point.outcome,
    failed_halves: point.failed_halves,
    reason: point.reason,
    detail: point.detail,
    time_limit_seconds: point.time_limit_seconds,
    halves: point.halves,
    rung: point.rung,
  };
}
