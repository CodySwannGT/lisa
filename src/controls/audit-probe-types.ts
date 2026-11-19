/**
 * The vocabulary of a probe: the record of one harmless read the audit tried
 * against an outside system a requirement depends on.
 *
 * A tool being configured does not mean an agent can reach it. So before the
 * audit says anything about a setting an outside system holds, it tries to
 * read that system, and writes down what happened as one probe:
 *
 * - `reachable`: the read was answered. The probe carries the request that
 *   was made, so "reachable" is never asserted without one.
 * - `unreachable`: the read was tried and refused. The probe quotes the error
 *   as it was received and says what access would be needed.
 * - `not-attempted`: no read was tried. The probe says why, and what access
 *   would be needed.
 *
 * The code that judges a report cannot see the network. What it can do is
 * hold the report to its own word, and that only works when "this finding
 * depends on that system" is data. It is: every probe lists, in `needed_by`,
 * the findings that rely on it, each by criterion and scope.
 *
 * A probe never holds a credential. It names the secret a request used and
 * leaves the value out (`./audit-report-rules/probe-secrets.ts`).
 *
 * A leaf module on purpose: the report's types import it, and it imports
 * nothing.
 * @module controls/audit-probe-types
 */

/** What became of one probe. */
export const AUDIT_PROBE_RESULTS = [
  "reachable",
  "unreachable",
  "not-attempted",
] as const;

/** One of the three results. */
export type AuditProbeResult = (typeof AUDIT_PROBE_RESULTS)[number];

/** The result that means the system answered. */
export const PROBE_REACHABLE: AuditProbeResult = "reachable";

/**
 * The id of the probe of the hosting platform: the system that holds the
 * repository's merge settings. The same word as the setup question that asks
 * where the repository is hosted, on purpose.
 */
export const HOSTING_PLATFORM_PROBE_ID = "hosting-platform";

/**
 * The id of the probe of the tracker. The same word as the setup question
 * that asks which tracker the team uses, on purpose. A tracker that answers
 * is a candidate answer to that question; it never answers it.
 */
export const TRACKER_PROBE_ID = "tracker";

/**
 * The ids that mean the same system in every report. Any other system is
 * recorded under a short name of its own, such as `sonarcloud`.
 */
export const FIXED_PROBE_IDS = [
  HOSTING_PLATFORM_PROBE_ID,
  TRACKER_PROBE_ID,
] as const;

/** A probe id: lower-case words joined by hyphens. */
export const PROBE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** The longest a probe id may be. */
export const PROBE_ID_MAX_LENGTH = 40;

/** One finding that relies on an outside system, by criterion and scope. */
export interface AuditProbeDependent {
  /** The finding's criterion id. */
  readonly criterion: string;
  /** The finding's scope; `.` is the whole repository. */
  readonly scope: string;
}

/**
 * The finding that always depends on the hosting platform: whether required
 * checks can be skipped is a setting the platform holds, and no file in the
 * repository shows it.
 */
export const SERVER_SIDE_AUTHORITY: AuditProbeDependent = {
  criterion: "AC5.1",
  scope: ".",
};

/** One read the audit tried, or declined to try, against an outside system. */
export interface AuditProbe {
  /**
   * A short name for the system, the same on every run: one of
   * {@link FIXED_PROBE_IDS}, or lower-case words joined by hyphens. Each
   * system is probed once, so an id appears once in a report.
   */
  readonly id: string;
  /** What the system is, in plain words on one line. */
  readonly system: string;
  /** The findings that rely on this system. Empty when none does. */
  readonly needed_by: readonly AuditProbeDependent[];
  readonly result: AuditProbeResult;
  /**
   * The read-only request that was made, on one line, with no credential in
   * it. Always present on `reachable`; present on `unreachable` when a request
   * was sent; never present on `not-attempted`.
   */
  readonly request?: string;
  /** The error, quoted as it was received. On `unreachable` only. */
  readonly observed_error?: string;
  /** Why no read was tried, in plain words. On `not-attempted` only. */
  readonly reason?: string;
  /**
   * The access an agent needs to read this system, in plain words on one
   * line. Present whenever the result is not `reachable`.
   */
  readonly access_needed?: string;
}
