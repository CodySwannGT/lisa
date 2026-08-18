/**
 * Reporting-side fixtures for the nightly e2e gate — §10.7 and §10.8.
 *
 * Split out of `nightly-e2e-gate-harness` rather than added to it, because that
 * file is shared by every truth-table suite and these fixtures are consumed by
 * the two REPORTING suites alone. The split also keeps the shared harness
 * inside the repo's per-file line ceiling, which is what forced the question.
 *
 * @module tests/helpers/nightly-e2e-reporting-harness
 */

/**
 * The measured answer to "does this gate actually block merges" (§10.7).
 *
 * `unknown` is a first-class member, not an error case: the reporter must be
 * able to say it does not know, because claiming either alternative on an
 * unreadable API is a false statement about somebody's merge queue.
 */
export interface Requiredness {
  readonly state: string;
  readonly detail: string | null;
  readonly contexts: readonly string[];
}

/** Tracking-issue actions (§10 of the contract). */
export const ISSUE_ACTION = Object.freeze({
  create: "create",
  refresh: "refresh",
  close: "close",
  none: "none",
});

/** Why the reporter chose an action, as a stable token per §10 row. */
export const ISSUE_REASON = Object.freeze({
  redFiled: "red_filed",
  redRefreshed: "red_refreshed",
  greenComplete: "green_complete",
  greenUntracked: "green_untracked",
  evidenceIncomplete: "evidence_incomplete",
  evidenceMissing: "evidence_missing",
});

/** One suite's reporting plan. */
export interface IssuePlanEntry {
  readonly label: string;
  readonly action: string;
  readonly reason: string;
  readonly state: string;
  readonly issues: readonly number[];
  readonly nodeIds: readonly string[];
  readonly requiredness: string;
  /** `true` pin, `false` unpin, `null` leave the pin alone. */
  readonly pin: boolean | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly comment: string | null;
}

/** An open issue as the reporter reads it. */
export interface TrackedIssue {
  readonly number: number;
  readonly body?: string | null;
  readonly node_id?: string;
  readonly pull_request?: Record<string, unknown>;
}

/** The outcome of one planned action. */
export interface IssueResult {
  readonly label: string;
  readonly action: string;
  readonly ok: boolean;
  readonly issues: readonly number[];
  readonly error: string | null;
  /** Non-fatal notes — a pin that did not land is one of these, never an error. */
  readonly warnings?: readonly string[];
}

/** The three states §10.7 may render. */
export const REQUIRED_STATE = Object.freeze({
  required: "required",
  notRequired: "not_required",
  unknown: "unknown",
});

/**
 * The status-check context Lisa's own caller template publishes.
 *
 * Measured from a live ruleset rather than copied from the template:
 * geminisportsai/frontend-v2's `dev` requires exactly this string.
 */
export const GATE_CONTEXT = "\u{1F319} Nightly E2E Health / \u{1F319} Gate";

/**
 * One `required_status_checks` rule, as `GET /repos/{o}/{r}/rules/branches/{b}`
 * returns it.
 *
 * The nesting is real and load-bearing — `parameters.required_status_checks[]`
 * with a `context` on each entry — so it is written out here once rather than
 * approximated per suite.
 *
 * @param contexts - The required contexts the rule carries
 * @returns A rule object
 */
export function requiredChecksRule(contexts: readonly string[]): unknown {
  return {
    type: "required_status_checks",
    ruleset_source_type: "Repository",
    ruleset_source: "o/r",
    ruleset_id: 1,
    parameters: {
      strict_required_status_checks_policy: false,
      required_status_checks: contexts.map(context => ({
        context,
        integration_id: 15368,
      })),
    },
  };
}
