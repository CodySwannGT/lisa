/**
 * What `lisa controls protect` reports.
 *
 * The command prints one JSON document of this shape on stdout. The enforce
 * step reads it to say, for each requirement, whether the hosting platform
 * now refuses a merge without the check that proves it (`wired`) or does not
 * (`blocked`), and why.
 * @module controls/protect-types
 */

/** Where the administrator handover is written, from the repository root. */
export const MERGE_PROTECTION_CHANGE_PATH =
  ".lisa/controls/merge-protection-change.md";

/** The format version of the result document. */
export const PROTECT_RESULT_SCHEMA_VERSION = 1;

/** The moment whose required checks the hosting platform enforces. */
export const PULL_REQUEST_MOMENT = "pull-request";

/** The platform the command can read and, when allowed, change. */
export const GITHUB_PLATFORM = "github";

/** The platform name used when nothing says where the repository is hosted. */
export const UNKNOWN_PLATFORM = "unknown";

/** Whether the platform refuses a merge without an entry's checks. */
export type ProtectOutcome = "wired" | "blocked";

/**
 * The run as a whole. `nothing-to-require` means the register holds no rule
 * the hosting platform is asked to enforce, which is neither of the others.
 */
export type ProtectSummary = ProtectOutcome | "nothing-to-require";

/** Whether the run was allowed to change anything on the platform. */
export type ProtectMode = "read-only" | "apply";

/**
 * Where one check stands on the platform.
 *
 * - `required`: the platform requires it on the branch.
 * - `missing`: it is not required, the platform shows it has been reported,
 *   and requiring it is the change to make. Only a `missing` check is ever
 *   sent in a write.
 * - `not-ready`: it is not required and nothing reports it yet — the platform
 *   shows no result under its name, or the repository has no workflow folder
 *   — so requiring it would hold every pull request waiting.
 * - `excluded`: the repository's own configuration says never to require it.
 * - `unknown`: a read did not answer. Either the platform's settings were not
 *   read, so nothing says whether it is required (`detail` is `null`), or
 *   they were and it is not required, but whether it has ever been reported
 *   could not be read (`detail` says so). It is never reported as required,
 *   never as known to be missing, and never sent in a write.
 */
export type CheckState =
  | "required"
  | "missing"
  | "not-ready"
  | "excluded"
  | "unknown";

/** One check the register derives for the pull-request moment. */
export interface RequiredCheck {
  /** The exact name the platform matches on. */
  readonly context: string;
  /** `workflow`: a pipeline job reports it. `external`: another app does. */
  readonly source: "workflow" | "external";
  /** The one app allowed to report an external check, or `null` for any. */
  readonly app_id: number | null;
  /** The gates in the declaration that derive this check. */
  readonly gates: readonly string[];
  readonly state: CheckState;
  /**
   * Why the check is held back rather than made required, as one plain
   * sentence or two; `null` when it is `required` or `missing`, and when
   * nothing was read at all.
   */
  readonly detail: string | null;
}

/** The outcome for one requirement an entry serves. */
export interface CriterionOutcome {
  readonly criterion: string;
  readonly outcome: ProtectOutcome;
  readonly reason: string;
}

/** The outcome for one register entry. */
export interface EntryOutcome {
  /** The register entry's identifier, for example `code-style@api`. */
  readonly id: string;
  readonly gate: string;
  readonly scope: string;
  /** The names of the checks that prove this entry on a pull request. */
  readonly checks: readonly string[];
  readonly outcome: ProtectOutcome;
  /** One plain sentence or more saying why. */
  readonly reason: string;
  /** The same outcome, once per requirement the entry serves. */
  readonly criteria: readonly CriterionOutcome[];
}

/** Where the repository is hosted, and how that was learned. */
export interface PlatformFacts {
  /** `github`, `gitlab`, `bitbucket`, `azure-devops`, another name, or `unknown`. */
  readonly name: string;
  /** `owner/name` on the platform, when the remote address gives one. */
  readonly repository: string | null;
  /** `remote`, `declaration` or `none`. */
  readonly detected_from: "remote" | "declaration" | "none";
  /** Whether this command may send the platform any request at all. */
  readonly reachable: boolean;
  /** Why not, when it may not. */
  readonly note: string | null;
}

/** What a read of the repository said about the signed-in account. */
export interface PermissionProbe {
  /** `true` or `false` as the platform answered; `null` when it did not say. */
  readonly can_change: boolean | null;
  readonly detail: string;
}

/** One request the run made, or declined to make. */
export interface SentRequest {
  readonly method: string;
  readonly path: string;
  /** `false` when the run refused to send it. */
  readonly sent: boolean;
}

/** What became of the handover file. */
export interface HandoverOutcome {
  readonly path: typeof MERGE_PROTECTION_CHANGE_PATH;
  /**
   * `written`: created or changed. `unchanged`: already said this. `removed`:
   * nothing is left to hand over. `none`: there was none and none is needed.
   */
  readonly action: "written" | "unchanged" | "removed" | "none";
}

/** The document `lisa controls protect` prints. */
export interface ProtectResult {
  readonly schema_version: typeof PROTECT_RESULT_SCHEMA_VERSION;
  readonly mode: ProtectMode;
  readonly outcome: ProtectSummary;
  readonly reason: string;
  readonly platform: PlatformFacts;
  /** The branch whose merge protection was compared, when one is known. */
  readonly branch: string | null;
  readonly permission: PermissionProbe;
  readonly required_checks: readonly RequiredCheck[];
  /** One line per check the platform is known not to require as derived. */
  readonly differences: readonly string[];
  /** Every request, in the order it was made. */
  readonly requests: readonly SentRequest[];
  readonly handover: HandoverOutcome;
  /** One per register entry the hosting platform is asked to enforce. */
  readonly entries: readonly EntryOutcome[];
}
