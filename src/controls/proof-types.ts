/**
 * The words and shapes of a paired proof.
 *
 * A paired proof is two planted changes: one that breaks a rule and one that
 * does not. A control works when its check turns the first away and lets the
 * second through. Everything here is plain data — what was run, what it
 * answered, what that means — so that a later step can write it down as
 * evidence without asking this one anything.
 *
 * ## The words
 *
 * One half of a proof shows one of three things ({@link ProofHalfOutcome}):
 *
 * - `rejected` — the check ran, said no, and said it in the failure text the
 *   entry declares.
 * - `accepted` — the check ran and passed.
 * - `unknown` — anything else. {@link ProofHalfReason} says which.
 *
 * An entry gets one of four results ({@link ProofOutcome}):
 *
 * - `passed` — the violating change was rejected and the clean one accepted.
 * - `failed` — the violating change was accepted, or the clean one rejected,
 *   or both. `failed_halves` names which.
 * - `unproved` — no proof was run: a half is missing, or the entry is not
 *   enforced at a moment this runner exercises.
 * - `unknown` — a proof was called for and gave no answer that can be
 *   trusted.
 *
 * A definite failure outranks a missing answer: an entry whose violating
 * change was accepted has failed, whatever its clean half did.
 * @module controls/proof-types
 */
import type { ProofHalf } from "./proof-halves.js";
import type {
  CommandMechanism,
  ControlRegisterEntry,
} from "./register-types.js";

// The two halves, in the order they are run, are named once: where the
// control register reads which of them are on record.
export { PROOF_HALVES, type ProofHalf } from "./proof-halves.js";

/** The format version of a proof run's results. */
export const PROOF_RUN_SCHEMA_VERSION = 1;

/** The moments this runner exercises, in the order a change reaches them. */
export const PROOF_MOMENTS = ["commit", "push"] as const;

/** What one half of a proof showed. */
export const PROOF_HALF_OUTCOMES = ["rejected", "accepted", "unknown"] as const;

/** What one half of a proof showed. */
export type ProofHalfOutcome = (typeof PROOF_HALF_OUTCOMES)[number];

/** Why one half of a proof showed what it did. */
export const PROOF_HALF_REASONS = [
  /** `rejected`: the check failed with the declared failure text. */
  "rejected-as-declared",
  /** `accepted`: the check passed. */
  "accepted",
  /** The change could not be put in place, so no check was run. */
  "patch-not-applied",
  /** The check could not be started at all. */
  "not-started",
  /** The check was stopped at the proof's time limit. */
  "timed-out",
  /** The check was killed before it answered. */
  "killed",
  /** The check answered, and the answer measured nothing. */
  "nothing-measured",
  /** The check said no without the declared failure text. */
  "wrong-reason",
  /** The check said no and the entry declares no failure text to match. */
  "no-failure-shape",
  /** An earlier change could not be undone, so this half was not run. */
  "workspace-not-restored",
] as const;

/** Why one half of a proof showed what it did. */
export type ProofHalfReason = (typeof PROOF_HALF_REASONS)[number];

/** The result an entry gets. */
export const PROOF_OUTCOMES = [
  "passed",
  "failed",
  "unproved",
  "unknown",
] as const;

/** The result an entry gets. */
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number];

/** Why an entry got its result, beyond what one of its halves says. */
export const PROOF_ENTRY_REASONS = [
  /** `passed`. */
  "proved",
  /** `failed` on the violating half. */
  "violation-accepted",
  /** `failed` on the clean half. */
  "clean-rejected",
  /** `failed` on both halves. */
  "violation-accepted-clean-rejected",
  /** `unproved`: the declaration names no patch for a half, or it is gone. */
  "half-missing",
  /** `unproved`: enforced only where the hosting platform decides. */
  "pull-request-moment",
  /** `unproved`: not enforced at any moment this runner exercises. */
  "no-proof-moment",
  /** `unknown`: the proof reaches outside the repository and was not allowed to. */
  "external-effects",
  /** `unknown`: what measures the entry is not a command this runner can start. */
  "mechanism-not-a-command",
  /** `unknown`: a patch file is there and could not be read safely. */
  "patch-unreadable",
  /**
   * `unknown`: one of the proof's changes edits a file that says what the
   * check is or runs it, so no check was started. The word is the one
   * `lisa controls proof-check` gives the same pair.
   */
  "declaration-changed",
  /**
   * `unproved`: the hosting platform's settings require the entry's check
   * before a merge. They were read; nothing was exercised.
   */
  "observed-required",
  /** `failed`: the hosting platform's settings do not require the check. */
  "observed-not-required",
  /** `unknown`: the hosting platform's settings could not be read. */
  "merge-protection-unread",
  /** `unknown`: the repository is not hosted where the settings are read. */
  "platform-not-reached",
  /** `unproved`: the register does not ask the platform to stop a merge. */
  "not-asked-of-platform",
  /** `unproved`: no check name derives from the entry for pull requests. */
  "no-check-derived",
  /** `unknown`: a canary pull request needs write access the run lacks. */
  "canary-permission-missing",
] as const;

/** Why an entry got its result. An `unknown` half's reason is one too. */
export type ProofEntryReason =
  | (typeof PROOF_ENTRY_REASONS)[number]
  | ProofHalfReason;

/**
 * How a result was obtained, weakest first.
 *
 * - `observed` — a setting was read that says the control is in force.
 *   Nothing was planted and nothing was run.
 * - `exercised` — both changes were planted and what stopped them, or did
 *   not, was recorded.
 */
export const PROOF_RUNGS = ["observed", "exercised"] as const;

/** How a result was obtained. */
export type ProofRung = (typeof PROOF_RUNGS)[number];

/** What the check answered when a half's moment was triggered. */
export interface ProofAnswer {
  /** What was started, one item per argument. */
  readonly command: readonly string[];
  /** The folder it was started in. */
  readonly cwd: string;
  /** Its exit status, or `null` when it never ran to an end. */
  readonly code: number | null;
  /** What it printed, or `null` when nothing was kept. */
  readonly output: string | null;
  /** The signal that ended it, when one did. */
  readonly signal?: string;
  /** Why nothing was started, when nothing was. */
  readonly notStarted?: string;
  /** Present and true when it was stopped at the proof's time limit. */
  readonly timedOut?: boolean;
}

/** The gate runner's own reading of an answer. */
export interface ProofJudgement {
  /**
   * What the gate runner makes of the answer: `passed`, `failed` (it measured
   * the rule and found it broken), `killed`, or `not-measured` for everything
   * it would not stand behind.
   */
  readonly verdict: "passed" | "failed" | "killed" | "not-measured";
  /** Whether the output carries the entry's declared failure text. */
  readonly declared: boolean;
  /** The lines of output that carry it, at most a handful. */
  readonly matched: readonly string[];
}

/** One half of one entry's proof, as it happened. */
export interface ProofHalfResult {
  /** The register entry the half belongs to. */
  readonly entry_id: string;
  readonly half: ProofHalf;
  /** The moment the half stood for: `commit` or `push`. */
  readonly moment: string;
  /** The patch file that was planted, from the repository root. */
  readonly patch: string;
  /** What was started, or `null` when the half never got that far. */
  readonly command: readonly string[] | null;
  /** The exit status, or `null` when nothing ran to an end. */
  readonly exit_status: number | null;
  /** When the half began, in UTC, from the injected clock. */
  readonly started_at: string;
  /** When the half's answer was in, in UTC, from the injected clock. */
  readonly completed_at: string;
  /**
   * The end of what the check printed, with the workspace path and every
   * credential-shaped value taken out before it was cut.
   */
  readonly output_excerpt: string;
  /** Whether the excerpt leaves out earlier output. */
  readonly output_truncated: boolean;
  /**
   * The output lines that carry the declared failure text, with the same
   * taken out of them.
   */
  readonly matched_lines: readonly string[];
  readonly outcome: ProofHalfOutcome;
  readonly reason: ProofHalfReason;
  /** The same, as a sentence for the operator. */
  readonly detail: string;
}

/** One register entry's result. */
export interface ProofEntryResult {
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  readonly criteria: readonly string[];
  /** The moment the proof stands for, or `null` when none was exercised. */
  readonly moment: string | null;
  readonly outcome: ProofOutcome;
  /** The halves that failed. Empty unless the outcome is `failed`. */
  readonly failed_halves: readonly ProofHalf[];
  readonly reason: ProofEntryReason;
  /** The same, as a sentence for the operator. */
  readonly detail: string;
  /** How long one half was allowed, or `null` when nothing was run. */
  readonly time_limit_seconds: number | null;
  /** The halves that were run, in the order they were run. */
  readonly halves: readonly ProofHalfResult[];
  /**
   * How the result was obtained. Present only on an entry that is enforced
   * on pull requests and not at commit or push, whose result comes from the
   * hosting platform (`./pull-request-settle.ts`). A commit or push result
   * carries no rung of its own: it is exercised whenever `halves` holds the
   * two halves, and nothing was obtained when it holds none.
   */
  readonly rung?: ProofRung;
}

/** How many entries got each result. */
export type ProofCounts = Readonly<Record<ProofOutcome, number>>;

/** Every entry's result. */
export interface ProofRun {
  readonly schema_version: typeof PROOF_RUN_SCHEMA_VERSION;
  /** True only when there is at least one entry and every entry passed. */
  readonly passed: boolean;
  readonly counts: ProofCounts;
  /** One result per register entry, in register order. */
  readonly entries: readonly ProofEntryResult[];
}

/** Whether a change went into the workspace, or came back out of it. */
export type PatchOutcome =
  | { readonly problem: null }
  | { readonly problem: string };

/** What the runner asks a workspace to trigger for one half. */
export interface ProofTrigger {
  readonly entry: ControlRegisterEntry;
  /** The moment the proof stands for: `commit` or `push`. */
  readonly moment: string;
  /** What measures the entry at that moment. */
  readonly mechanism: CommandMechanism;
  /** How long the half may run, in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * Where a proof's changes are planted and its moment is triggered.
 *
 * The runner decides what a proof means; a workspace decides only where it
 * happens. The runner calls `apply`, then `trigger`, then `restore`, once per
 * half and never two at a time, and reads nothing from the workspace but
 * what these return. Each may answer straight away or with a promise.
 */
export interface ProofWorkspace {
  /** The folder the changes are planted in, with every link resolved. */
  readonly root: string;
  /**
   * Plant one change. All of it or none of it.
   * @param patch - The content of the patch file
   */
  readonly apply: (patch: string) => PatchOutcome | Promise<PatchOutcome>;
  /**
   * Name a file the change planted right now edits that says what the
   * checks are or runs them, or `null` when it edits none
   * (`./proof-change-rule.ts`). The runner asks this of each change of a
   * pair before it starts any check, and runs no proof for a pair that
   * edits one.
   *
   * A workspace leaves it out only when nothing that decides what a check
   * is, or whether it runs, is read from the folder the change is planted
   * in.
   */
  readonly changedCheckFile?: () => string | null | Promise<string | null>;
  /**
   * Trigger the moment and say what answered.
   * @param request - The entry, its moment, its mechanism and the time limit
   */
  readonly trigger: (
    request: ProofTrigger
  ) => ProofAnswer | Promise<ProofAnswer>;
  /**
   * Put the workspace back as it was before `apply`.
   * @param patch - The content of the patch file that was planted
   */
  readonly restore: (patch: string) => PatchOutcome | Promise<PatchOutcome>;
}
