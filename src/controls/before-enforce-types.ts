/**
 * The words and shapes of a before-enforce run.
 *
 * `lisa controls attest --before-enforce` asks one question of a repository
 * in which nothing has been installed yet: a tool is there, and does a
 * change that breaks its rule still go through? It answers by making a real
 * commit or push of the violating change in a fresh clone, and by running
 * the tool's own command on the same change.
 *
 * ## Why these are not a proof's words
 *
 * A paired proof says whether an installed control works: `passed`,
 * `failed`, `unproved`, `unknown`. This run says something else, about a
 * repository before anything is installed, so it has words of its own and
 * none of them can be read as a proof's result:
 *
 * - `not-enforced`: the violating change went through, and the tool's own
 *   command ran on it. The tool exists and nothing makes it run.
 * - `enforced`: something in the fresh clone refused the violating change.
 * - `not-exercised`: nothing was tried, and the reason says why.
 * - `unknown`: it was tried and gave no answer that can be relied on.
 *
 * A run is a diagnosis. It is printed and never written: no evidence
 * record, no register, no verdict. So it cannot claim a Level 1 result and
 * cannot set or clear an entry's `unproved` mark.
 * @module controls/before-enforce-types
 */
import type { AuditFinding } from "./audit-report-types.js";
import type { ProofHalfOutcome, ProofHalfReason } from "./proof-types.js";

/** The format version of a before-enforce run's result. */
export const BEFORE_ENFORCE_SCHEMA_VERSION = 1;

/** What the result calls itself, so it is never taken for a proof run. */
export const BEFORE_ENFORCE_MODE = "before-enforce";

/** What one register entry comes out as. */
export const BEFORE_ENFORCE_RESULTS = [
  "not-enforced",
  "enforced",
  "not-exercised",
  "unknown",
] as const;

/** What one register entry comes out as. */
type BeforeEnforceResult = (typeof BEFORE_ENFORCE_RESULTS)[number];

/** Why an entry was not exercised: nothing was touched for it. */
export const NOT_EXERCISED_REASONS = [
  /** Checked only on pull requests, which the hosting platform decides. */
  "pull-request-moment",
  /** Checked at no commit, push or pull request. */
  "no-proof-moment",
  /** A violating or a clean change is not declared, or its file is gone. */
  "half-missing",
  /** What measures it is not a command that can be started. */
  "mechanism-not-a-command",
  /** Its proof reaches outside the repository and was not allowed to. */
  "external-effects",
  /** A patch file is there and could not be read safely. */
  "patch-unreadable",
  /** Declared optional at its moment: it reports and never refuses. */
  "optional-at-moment",
] as const;

/** Why an entry that was tried gave no answer. */
type UnansweredReason =
  /** The violating change could not be put in place. */
  | "patch-not-applied"
  /** The commit or push did not run to an end that can be believed. */
  | "not-started"
  /** The commit or push was stopped at the time limit. */
  | "timed-out"
  /** The commit or push was killed before it answered. */
  | "killed"
  /** An earlier change could not be taken back out of the copy. */
  | "workspace-not-restored"
  /** The change went through, but the tool's own command gave no answer. */
  | "tool-not-run";

/** Why an entry came out as it did. */
export type BeforeEnforceReason =
  /** `not-enforced`. */
  | "violation-accepted"
  /** `enforced`. */
  | "violation-rejected"
  | (typeof NOT_EXERCISED_REASONS)[number]
  | UnansweredReason;

/** What a whole run comes to. */
export const BEFORE_ENFORCE_OUTCOMES = [
  /** At least one entry is `not-enforced`, and every entry was answered. */
  "findings",
  /** Something was exercised and nothing came out `not-enforced`. */
  "nothing-found",
  /** There are entries, and none could be exercised yet. */
  "nothing-exercised",
  /** The register has no entries. */
  "nothing-declared",
  /** At least one entry was tried and gave no answer. */
  "incomplete",
] as const;

/** What a whole run comes to. */
export type BeforeEnforceOutcome = (typeof BEFORE_ENFORCE_OUTCOMES)[number];

/** What a recorded command left behind. */
interface RecordedCommand {
  /** What was started, or `null` when nothing was. */
  readonly command: readonly string[] | null;
  /** The exit status, or `null` when nothing ran to an end. */
  readonly exit_status: number | null;
  /** When it began, in UTC, from the injected clock. */
  readonly started_at: string;
  /** When its answer was in, in UTC, from the injected clock. */
  readonly completed_at: string;
  /** The end of what it printed, with the copy's folder taken out. */
  readonly output_excerpt: string;
  /** Whether the excerpt leaves out earlier output. */
  readonly output_truncated: boolean;
  /** The same as a sentence for the operator. */
  readonly detail: string;
}

/**
 * The canary: the real commit or push of the violating change in the fresh
 * clone. When its outcome is `accepted`, this record is the evidence that a
 * bad change goes through.
 */
export interface BeforeEnforceCanary extends RecordedCommand {
  /** The patch file that was planted, from the repository root. */
  readonly patch: string;
  /** The moment that was triggered: `commit` or `push`. */
  readonly moment: string;
  /**
   * `accepted`: git exited 0 and the change got where the moment takes it.
   * `rejected`: git exited non-zero and it did not. `unknown`: anything else.
   */
  readonly outcome: ProofHalfOutcome;
}

/**
 * What the entry's own command said about the same violating change, started
 * directly. It shows the tool is there; it is not a proof of a control.
 */
export interface BeforeEnforceTool extends RecordedCommand {
  /** The output lines that carry the entry's declared failure text. */
  readonly matched_lines: readonly string[];
  /**
   * `rejected`: the tool failed the change with the declared failure text.
   * `accepted`: the tool passed it. `unknown`: see `reason`.
   */
  readonly outcome: ProofHalfOutcome;
  readonly reason: ProofHalfReason;
}

/** One register entry's result. */
export interface BeforeEnforceEntry {
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  readonly criteria: readonly string[];
  /** The moment that was, or would be, triggered; `null` when there is none. */
  readonly moment: string | null;
  readonly result: BeforeEnforceResult;
  readonly reason: BeforeEnforceReason;
  /** The same as a sentence for the operator. */
  readonly detail: string;
  /** The commit or push of the violating change; `null` when none was made. */
  readonly canary: BeforeEnforceCanary | null;
  /** The tool's own answer; `null` when its command was not started. */
  readonly tool: BeforeEnforceTool | null;
}

/** What the fresh clone the run worked in was, as measured there. */
export interface BeforeEnforceCopy {
  /** The commit the clone was made from. */
  readonly commit: string;
  /** The branch it was on; `null` on a detached `HEAD`. */
  readonly branch: string | null;
  /** Whether the operator's working copy held work that is not committed. */
  readonly uncommitted_work: boolean;
  /** The files taken from the working copy because they describe the checks. */
  readonly carried: readonly string[];
  /** Always false: this run installs no carrier. */
  readonly carriers_installed: false;
  /** The clone's own `core.hooksPath`, or `null` when it sets none. */
  readonly hooks_path: string | null;
  /**
   * The hook files in the folder git reads in the clone, by name, leaving
   * out the examples git ships. Usually none.
   */
  readonly hooks: readonly string[];
}

/** How many entries came out as each result. */
export type BeforeEnforceCounts = Readonly<Record<BeforeEnforceResult, number>>;

/** Everything a before-enforce run found. */
export interface BeforeEnforceRun {
  readonly schema_version: typeof BEFORE_ENFORCE_SCHEMA_VERSION;
  readonly mode: typeof BEFORE_ENFORCE_MODE;
  readonly outcome: BeforeEnforceOutcome;
  /** The same as a sentence for the operator. */
  readonly reason: string;
  /** The fresh clone, or `null` when nothing could be exercised and none was made. */
  readonly copy: BeforeEnforceCopy | null;
  /** The files this run wrote in the repository. Always empty. */
  readonly wrote: readonly string[];
  readonly counts: BeforeEnforceCounts;
  /** One result per register entry, in register order. */
  readonly entries: readonly BeforeEnforceEntry[];
  /**
   * One finding per requirement and placement a `not-enforced` entry bears
   * on, in the audit report's finding shape and in state
   * `exists-not-enforced`. Offered, never written: the step that owns the
   * report replaces its finding at the same `criterion` and `scope`.
   */
  readonly audit_findings: readonly AuditFinding[];
  /** What this run does not show, in plain sentences. */
  readonly limits: readonly string[];
}
