/**
 * The words and shapes of `lisa controls proof-check`.
 *
 * A paired proof is two small changes kept as patch files beside the
 * declaration: one that breaks a check's rule and one that does not. Whoever
 * writes them needs to know, before anything is installed, whether the pair
 * is one the attest step will be able to use. This command says so, part by
 * part, and for a pair that is not usable it says in one plain sentence what
 * to change.
 *
 * It is a feedback loop for the author of the patches and nothing more. It
 * writes no evidence, no register and no verdict, and a `ready` here is not
 * a proof of a control: only `lisa controls attest` says a control works.
 *
 * ## The words
 *
 * A part gets one of three results ({@link ProofCheckResult}):
 *
 * - `ready` — the check's own command failed on the violating change with
 *   the declared failure text, and passed on the clean change.
 * - `not-ready` — something has to change first. `reason` says what, as a
 *   code; `detail` says it as a sentence, with what to change.
 * - `no-proof` — the part declares no patch file at all. It is listed, it
 *   stays unproved, and it does not fail the command.
 * @module controls/proof-check-types
 */
import type { BeforeEnforceTool } from "./before-enforce-types.js";
import type { ProofHalf } from "./proof-halves.js";

/** The format version of the command's result. */
export const PROOF_CHECK_SCHEMA_VERSION = 1;

/** The result one part gets. */
export const PROOF_CHECK_RESULTS = ["ready", "not-ready", "no-proof"] as const;

/** The result one part gets. */
export type ProofCheckResult = (typeof PROOF_CHECK_RESULTS)[number];

/**
 * Why a part got its result. The reasons of a part that is `not-ready` are
 * listed in the order the questions are asked, and the first that applies is
 * the one reported.
 */
export const PROOF_CHECK_REASONS = [
  /** `ready`. */
  "ready",
  /** `no-proof`: the part names no patch file. */
  "no-proof",
  /** One half names a patch file and the other names none. */
  "half-not-declared",
  /** A declared patch file is not there. */
  "patch-missing",
  /** A declared patch file is there and could not be read safely. */
  "patch-unreadable",
  /** Both patch files hold the same change. */
  "patches-identical",
  /** No failure text is declared, so a rejection could never be counted. */
  "no-failure-text",
  /** What measures the part is not a command that can be started. */
  "not-a-command",
  /** The proof says it reaches outside the repository and was not allowed to. */
  "external-effects",
  /** A change does not apply to the last commit. */
  "patch-not-applied",
  /**
   * A change edits what the check is: the file that declares the checks, a
   * file that starts them, or the script the part's command runs.
   */
  "declaration-changed",
  /** A change touches a path the repository ignores. */
  "ignored-path",
  /** A change leaves nothing git would commit. */
  "no-change",
  /** A change touches no file inside the part's own folder. */
  "outside-folder",
  /** The command could not be started on a change. */
  "not-started",
  /** The command was still running at the time limit. */
  "timed-out",
  /** The command was stopped before it answered. */
  "killed",
  /** The command ran and its own output says it measured nothing. */
  "nothing-measured",
  /** The command passed on the violating change. */
  "violation-accepted",
  /** The command failed on the violating change without the declared text. */
  "wrong-failure-text",
  /** The command failed on the clean change. */
  "clean-rejected",
  /** The command passed on the clean change and still printed the declared text. */
  "failure-text-on-clean",
] as const;

/** Why a part got its result. */
export type ProofCheckReason = (typeof PROOF_CHECK_REASONS)[number];

/** What a whole run comes to. */
export const PROOF_CHECK_OUTCOMES = [
  /** At least one part declares a proof, and every one that does is ready. */
  "ready",
  /** At least one part's proof is not ready. */
  "not-ready",
  /** No part declares a proof, so there was nothing to check. */
  "nothing-to-check",
] as const;

/** What a whole run comes to. */
export type ProofCheckOutcome = (typeof PROOF_CHECK_OUTCOMES)[number];

/** What a part's declaration says about its proof. */
export interface DeclaredProof {
  /** The patch file of the violating change, or `null` when none is named. */
  readonly violation: string | null;
  /** The patch file of the clean change, or `null` when none is named. */
  readonly clean: string | null;
  /** The declared failure text; empty when none is declared. */
  readonly failure_shape: readonly string[];
}

/** One change that was tried in the temporary copy. */
export interface ProofCheckHalf {
  readonly half: ProofHalf;
  /** The patch file, from the repository root. */
  readonly patch: string;
  /**
   * The paths the change touches, from the repository root, as git lists
   * them once the change is staged.
   */
  readonly changed_paths: readonly string[];
  /**
   * What the part's own command said about the change, started directly in
   * the part's folder. `null` when the command was not started on it,
   * because an earlier question already settled the part.
   */
  readonly run: BeforeEnforceTool | null;
}

/** One declared part's result. */
export interface ProofCheckPart {
  /** The register entry the part becomes: `<gate>@<scope>`. */
  readonly entry_id: string;
  readonly gate: string;
  readonly scope: string;
  readonly result: ProofCheckResult;
  readonly reason: ProofCheckReason;
  /** The same as a sentence: what is wrong, and what to change. */
  readonly detail: string;
  /**
   * Something a `ready` does not say: why `lisa controls attest` will still
   * not prove this part at commit or push. `null` when there is nothing to
   * add.
   */
  readonly note: string | null;
  readonly proof: DeclaredProof;
  /** The changes that were tried, in the order they were tried. */
  readonly halves: readonly ProofCheckHalf[];
}

/** The temporary copy the changes were tried in. */
export interface ProofCheckCopy {
  /** The commit every change was put on. */
  readonly commit: string;
  /** Whether the working copy held work that is not committed. */
  readonly uncommitted_work: boolean;
  /** The files taken from the working copy because they describe the checks. */
  readonly carried: readonly string[];
}

/** How many parts got each result. */
export type ProofCheckCounts = Readonly<Record<ProofCheckResult, number>>;

/** Everything one run of the command found. */
export interface ProofCheckRun {
  readonly schema_version: typeof PROOF_CHECK_SCHEMA_VERSION;
  readonly outcome: ProofCheckOutcome;
  /** The same as a sentence. */
  readonly reason: string;
  /** The temporary copy, or `null` when no change had to be tried in one. */
  readonly copy: ProofCheckCopy | null;
  readonly counts: ProofCheckCounts;
  /** One result per declared part, in register order. */
  readonly parts: readonly ProofCheckPart[];
}
