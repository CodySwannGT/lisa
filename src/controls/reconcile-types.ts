/**
 * The shape of what `lisa controls reconcile` reports.
 *
 * A control register records what a team believes it enforces. This command
 * measures the distance between that record and what is installed, in both
 * directions, and prints one JSON document of this shape:
 *
 * - `enforcement_points`: every enforcement point the register claims, and
 *   whether something real was found to run the gate runner there.
 * - `hook_commands`: every command the commit and push hooks run, and which
 *   register entries declare it.
 * - `findings`: the two kinds of distance, one line each for an operator. A
 *   claimed point nothing runs, and a command that runs with no entry that
 *   declares it.
 * - `audit_findings`: the same findings in the audit report's finding
 *   shape, for the step that owns that report to merge. This command never
 *   writes the report.
 *
 * A leaf module: every other reconcile module imports its words from here.
 * @module controls/reconcile-types
 */
import type { AuditFinding } from "./audit-report-types.js";
import type { HookOwner } from "./carrier-types.js";
import type {
  EnforcementLevel,
  EnforcementLocation,
} from "./register-types.js";

/** The format version of the result document. */
export const RECONCILE_SCHEMA_VERSION = 1;

/** The command a person runs, as it is written in messages. */
export const RECONCILE_INVOCATION = "lisa controls reconcile";

/**
 * The requirement a control register answers: one list of every rule, kept
 * in step with what actually runs. Every distance this command finds bears
 * on it, whatever else it bears on.
 */
export const CONTROL_REGISTER_CRITERION = "AC5.9";

/** The flag that asks for the one read that leaves this machine. */
export const PLATFORM_FLAG = "--platform";

/**
 * What was established about one enforcement point.
 *
 * - `wired`: something was found that runs the gate runner there.
 * - `not-wired`: it was looked for and is not there. This is a finding.
 * - `not-verifiable`: this command has no way to look there.
 * - `not-read`: the place that holds the answer was not asked, or was asked
 *   and did not answer. Never a finding: not knowing is not absence.
 */
export const POINT_STATES = [
  "wired",
  "not-wired",
  "not-verifiable",
  "not-read",
] as const;

/** The state of one enforcement point. */
export type PointState = (typeof POINT_STATES)[number];

/** What was established about one point, before it is tied to its entry. */
export interface PointVerdict {
  readonly state: PointState;
  /** Why, in a plain sentence or two. */
  readonly reason: string;
  /** The file, setting or check that was looked at; `null` when none was. */
  readonly checked: string | null;
}

/** One enforcement point the register claims, and what was found there. */
export interface ReconciledPoint extends PointVerdict {
  /** The register entry the point belongs to, for example `code-style@api`. */
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  readonly moment: string;
  readonly location: EnforcementLocation;
  readonly level: EnforcementLevel;
}

/** One command a hook runs. */
export interface HookCommand {
  /** The moment the hook runs at: `commit` or `push`. */
  readonly moment: string;
  /** The git hook: `pre-commit` or `pre-push`. */
  readonly hook: string;
  /** The file that holds the command, from the repository root when inside. */
  readonly path: string;
  /** The line it is on, counted from 1. */
  readonly line: number;
  /** The command, as it is written there. */
  readonly command: string;
  /** Who runs the file: a hook manager, a hooks folder, or Lisa. */
  readonly through: HookOwner;
  /**
   * The register entries whose measuring mechanism at this moment is this
   * command. Empty when no entry declares it.
   */
  readonly declared_by: readonly string[];
}

/** The places the command reads. */
export const RECONCILE_SURFACES = [
  "register",
  "carriers",
  "hooks",
  "hosting-platform",
] as const;

/** One place the command reads. */
export type ReconcileSurface = (typeof RECONCILE_SURFACES)[number];

/**
 * What became of one read.
 *
 * - `read`: it was read.
 * - `not-asked`: it was not read because the run did not ask for it.
 * - `not-needed`: nothing in the register depends on it.
 * - `could-not-read`: it was needed and could not be read. The run exits
 *   non-zero and `detail` says what was in the way.
 */
export type SurfaceState =
  | "read"
  | "not-asked"
  | "not-needed"
  | "could-not-read";

/** One place the command reads, and what became of the read. */
export interface SurfaceRead {
  readonly surface: ReconcileSurface;
  readonly state: SurfaceState;
  /** What a person should know about the read; `null` when nothing. */
  readonly detail: string | null;
}

/** A claimed enforcement point that nothing runs. */
export interface PointFinding {
  readonly kind: "enforcement-point-not-wired";
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  /** The requirements the entry serves. */
  readonly criteria: readonly string[];
  readonly moment: string;
  readonly location: EnforcementLocation;
  /** What was found, as one line for an operator. */
  readonly message: string;
  /** What to do about it. */
  readonly next: string;
}

/** A command a hook runs that no register entry declares. */
export interface CommandFinding {
  readonly kind: "undeclared-command";
  readonly moment: string;
  readonly hook: string;
  readonly path: string;
  readonly line: number;
  readonly command: string;
  /** What was found, as one line for an operator. */
  readonly message: string;
  /** What to do about it. */
  readonly next: string;
}

/** One distance between the register and what is installed. */
export type ReconcileFinding = PointFinding | CommandFinding;

/**
 * Whether the committed register is what the declaration generates now.
 *
 * - `current`: the file is byte for byte what would be written.
 * - `stale`: the file differs; `lisa controls register` would rewrite it.
 * - `absent`: there is no file.
 */
export type CommittedRegister = "current" | "stale" | "absent";

/** The register the points were read from. */
export interface ReconciledRegister {
  /** Where the register is committed, from the repository root. */
  readonly path: string;
  /** How many entries the declaration generates. */
  readonly entries: number;
  readonly committed: CommittedRegister;
}

/**
 * The run as a whole.
 *
 * - `in-step`: every surface that was needed was read, and nothing differs.
 * - `findings`: every surface that was needed was read, and something does.
 * - `incomplete`: a surface that was needed could not be read. Whatever was
 *   found elsewhere is still listed.
 */
export type ReconcileOutcome = "in-step" | "findings" | "incomplete";

/** The result of one run, printed as one JSON document. */
export interface ReconcileResult {
  readonly schema_version: typeof RECONCILE_SCHEMA_VERSION;
  readonly outcome: ReconcileOutcome;
  /** The outcome in one sentence. */
  readonly reason: string;
  readonly register: ReconciledRegister;
  /** Who owns git hooks in this checkout. */
  readonly hook_owner: HookOwner;
  /** Every place that was read, or was not, in a fixed order. */
  readonly surfaces: readonly SurfaceRead[];
  /** Every enforcement point the register claims, in register order. */
  readonly enforcement_points: readonly ReconciledPoint[];
  /** Every command the commit and push hooks run, commit first. */
  readonly hook_commands: readonly HookCommand[];
  /** Every distance found, missing points first. */
  readonly findings: readonly ReconcileFinding[];
  /**
   * The same findings in the audit report's finding shape, one per
   * requirement and placement they bear on, each in state
   * `exists-not-enforced`. Offered to the step that owns the audit report;
   * this command never writes that report.
   */
  readonly audit_findings: readonly AuditFinding[];
  /** What this command does not read, so that silence is not over-read. */
  readonly limits: readonly string[];
}

/** What this command does not read, said with every result. */
export const RECONCILE_LIMITS: readonly string[] = [
  "Only the hooks git runs before a commit and before a push are read. Other git hooks, such as the one that checks a commit message, are not.",
  "A hook is read as text, one line at a time, and nothing in it is ever run. A hook that calls a script is reported as that call: the script itself is not opened.",
  "A command counts as declared only when a register entry's check at the same moment is that command, word for word. The folder it runs in is not compared.",
  "A pull-request pipeline file is checked for the gate runner's pull-request command as text. That cannot show that the hosting platform runs the pipeline or requires it before a merge.",
  "Deployment pipelines and scheduled runs are not looked at.",
];
