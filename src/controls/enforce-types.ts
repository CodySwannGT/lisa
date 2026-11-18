/**
 * The shape of what `lisa controls enforce-report` prints.
 *
 * The enforce step makes a control register real: it installs the carriers
 * that run the declared checks, files a ticket for each requirement the
 * repository has nothing for, and compares the hosting platform's merge
 * protection with the register. This command reads what those three steps
 * reported and says, for every Level 1 requirement, exactly one thing about
 * it.
 *
 * ## The outcomes
 *
 * - `wired`: a declared check serves the requirement, and every place the
 *   enforce step is answerable for now runs it.
 * - `ticketed`: the repository has nothing for the requirement, and a ticket
 *   for that work exists.
 * - `blocked`: the enforce step could not make it real, and somebody has to
 *   act first. The reason says who and what for.
 * - `nothing-to-enforce`: the enforce step has nothing to install, file or
 *   wait for. The requirement does not apply here; or it is met by a written
 *   record or a person's word, which no hook can run; or what checks it is
 *   something a Lisa project type ships and runs where this step neither
 *   installs nor looks. Whether such a requirement is met is the attest
 *   step's to say. A requirement that needs a check never gets this outcome
 *   because its check has no moment to run at: that is `blocked`.
 *
 * The product requirement names the first three. The fourth is here because
 * the three cannot be said truthfully of a requirement that needs nothing
 * from this step: calling a written policy `wired` would claim a check runs,
 * and calling it `blocked` would tell the operator to act where there is
 * nothing to do. `lisa controls protect` met the same case and answered it
 * the same way, with `nothing-to-require`.
 *
 * Every requirement still gets exactly one outcome, and the command fails
 * when one has none or two.
 *
 * ## Why this is printed and not written to a file
 *
 * An outcome depends on things outside the repository at one moment: what
 * the tracker holds, what the hosting platform requires, and whether git in
 * this one checkout is set to run hooks. A committed file would repeat
 * `wired` in a clone where nothing is wired, and it would be one more thing
 * a second run could change. So the document is the answer to one run.
 * @module controls/enforce-types
 */
import type {
  EnforcementLevel,
  EnforcementLocation,
} from "./register-types.js";

/** The format version of the result document. */
export const ENFORCE_REPORT_SCHEMA_VERSION = 1;

/** The command a person runs, as it is written in messages. */
export const ENFORCE_REPORT_INVOCATION = "lisa controls enforce-report";

/** The enforce step has nothing to install, file or wait for. */
export const NOTHING_TO_ENFORCE = "nothing-to-enforce";

/**
 * Every outcome, strongest first: when a requirement's sources disagree, the
 * one listed first here is the requirement's outcome. Something still waiting
 * on a person outranks a ticket, a ticket outranks a check that runs, and a
 * check that runs outranks having nothing to do.
 */
export const ENFORCE_OUTCOMES = [
  "blocked",
  "ticketed",
  "wired",
  NOTHING_TO_ENFORCE,
] as const;

/** The one thing the enforce step says about a requirement. */
export type EnforceOutcome = (typeof ENFORCE_OUTCOMES)[number];

/**
 * Whether something runs a check at one enforcement point.
 *
 * - `wired`: a read of the checkout's carriers made for this report, or
 *   the merge-protection result, says that it does.
 * - `blocked`: one of them says that it does not, and why.
 * - `not-checked`: the enforce step installs nothing at this moment and has
 *   no way to look there, so it says nothing.
 */
export type EnforcedPointState = "wired" | "blocked" | "not-checked";

/** One enforcement point of a register entry, and what was reported of it. */
export interface EnforcedPoint {
  readonly moment: string;
  readonly location: EnforcementLocation;
  readonly level: EnforcementLevel;
  readonly state: EnforcedPointState;
  /** Why, in a plain sentence or two. */
  readonly reason: string;
}

/** What an entry's points add up to. A ticket is never an entry's outcome. */
export type EnforcedEntryOutcome = Exclude<EnforceOutcome, "ticketed">;

/** One register entry, and whether the checks it declares now run. */
export interface EnforcedEntry {
  /** The register entry's identifier, for example `code-style@api`. */
  readonly id: string;
  readonly gate: string;
  readonly scope: string;
  /** The requirements the entry serves, in catalogue order. */
  readonly criteria: readonly string[];
  readonly outcome: EnforcedEntryOutcome;
  readonly reason: string;
  readonly points: readonly EnforcedPoint[];
}

/** Where one statement about a requirement comes from. */
export type EnforceClaimSource = "register-entry" | "audit-finding";

/** One source's statement about a requirement. */
export interface EnforceClaim {
  readonly source: EnforceClaimSource;
  /**
   * The register entry's id, or `<requirement id>@<folder>` for a finding of
   * the audit report.
   */
  readonly id: string;
  /** The folder the statement is about; `.` is the whole repository. */
  readonly scope: string;
  readonly outcome: EnforceOutcome;
  /** Why, in plain words. For `blocked`: who has to do what. */
  readonly reason: string;
  /** The ticket's reference when `ticketed`; `null` otherwise. */
  readonly ticket: string | null;
}

/** The one outcome of one requirement, and what it was derived from. */
export interface CriterionEnforcement {
  /** The requirement's id. Detail: never shown to an operator on its own. */
  readonly criterion: string;
  /** The requirement as the catalogue's plain question. */
  readonly question: string;
  /** `gate`, `artifact` or `human-attested`, as the catalogue says. */
  readonly kind: string;
  readonly outcome: EnforceOutcome;
  /** The reasons of the claims that decided the outcome, joined. */
  readonly reason: string;
  /** Every ticket filed for the requirement, in folder order. */
  readonly tickets: readonly string[];
  /** Every statement about the requirement, strongest first. */
  readonly claims: readonly EnforceClaim[];
}

/** One thing a step of this run said it changed. */
export interface ReportedChange {
  /** The step that made the change. */
  readonly step: "carriers" | "tickets" | "merge-protection";
  /** The file, the git setting, the ticket or the request that changed. */
  readonly target: string;
  /** What was done: `create`, `update`, `set`, `written`, `removed`, `sent`. */
  readonly action: string;
}

/** A required check that fails on the head of the default branch. */
export interface FailingGate {
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  /** The requirements the entry serves. */
  readonly criteria: readonly string[];
  /** The command that was run, one item per argument. */
  readonly command: readonly string[];
  readonly exit_status: number | null;
  /**
   * How the gate runner read the answer. `failed`: it read a broken rule in
   * the output. `unproved`: the command ended with an error, or said it ran
   * nothing, and the runner cannot tell a broken rule from a broken command.
   * Either way a required check that is not proved stops a change.
   */
  readonly judged: "failed" | "unproved";
  /** The end of what the command printed. */
  readonly output_excerpt: string;
  /** Whether earlier output was left out. */
  readonly output_truncated: boolean;
  /**
   * Whether the output carries the failure text the entry declares; `null`
   * when the entry declares none, so nothing says why the command failed.
   */
  readonly matched_failure_shape: boolean | null;
}

/** A required check that was not, or could not be, measured. */
export interface UnmeasuredGate {
  readonly entry_id: string;
  /** Why, in a plain sentence. */
  readonly reason: string;
}

/** The commit the required checks were run against. */
export interface DefaultBranchHead {
  /** The branch's name, for example `main`. */
  readonly branch: string;
  /** The ref that was read, for example `refs/remotes/origin/main`. */
  readonly ref: string;
  readonly commit: string;
  /** How the default branch was told apart from the others. */
  readonly chosen_by:
    | "hosting-platform"
    | "origin-head"
    | "conventional-name"
    | "current-branch";
}

/** What running the required checks on the default branch's head found. */
export interface CurrentlyFailing {
  /** Whether the checks were run at all. */
  readonly measured: boolean;
  /** How they were run, or why they were not. */
  readonly reason: string;
  readonly head: DefaultBranchHead | null;
  /**
   * How many checks were run to an answer. Zero with `not_measured` not
   * empty means nothing is known about whether the checks pass: it is never
   * a clean result.
   */
  readonly checked: number;
  /** The checks that fail there, each with its command's output. */
  readonly gates: readonly FailingGate[];
  /** The checks that gave no answer. Never counted as failing. */
  readonly not_measured: readonly UnmeasuredGate[];
}

/** How many requirements have each outcome. */
export type EnforceCounts = Readonly<Record<EnforceOutcome, number>>;

/** The document `lisa controls enforce-report` prints. */
export interface EnforceReport {
  readonly schema_version: typeof ENFORCE_REPORT_SCHEMA_VERSION;
  /** The whole result in one sentence. */
  readonly reason: string;
  /** How many requirements Level 1 holds; always the length of `criteria`. */
  readonly requirements: number;
  readonly counts: EnforceCounts;
  /** One per in-scope requirement, in catalogue order. */
  readonly criteria: readonly CriterionEnforcement[];
  /** One per register entry, in register order. */
  readonly entries: readonly EnforcedEntry[];
  readonly currently_failing: CurrentlyFailing;
  /**
   * Everything the three steps said they changed in this run. Empty on a run
   * that found everything already in place.
   */
  readonly changes: readonly ReportedChange[];
  /** What this result does not show, each as one plain sentence. */
  readonly limits: readonly string[];
}
