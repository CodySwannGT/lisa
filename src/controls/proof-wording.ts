/**
 * What a proof's results say to the person reading them.
 *
 * Every result carries a short code for a program and a sentence for a
 * person. The sentences live here, in one place, so they stay consistent
 * with each other and can be read without knowing how a proof is run: they
 * say what happened to the planted change and, where it helps, what to do
 * about it.
 * @module controls/proof-wording
 */
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import type { ChangeFinding } from "./proof-change-rule.js";
import {
  TASK_RUNNER_KINDS,
  TASK_RUNNER_PROGRAMS,
} from "./proof-task-runners.js";
import type {
  ProofEntryReason,
  ProofHalf,
  ProofHalfReason,
} from "./proof-types.js";

/** What each half's change is called in a sentence. */
export const HALF_NAMES: Readonly<Record<ProofHalf, string>> = {
  violation: "violating",
  clean: "clean",
};

/** The facts a half's sentence may quote. */
export interface HalfFacts {
  /** The patch file, from the repository root. */
  readonly patch: string;
  /** The failure text the entry declares. */
  readonly shape: readonly string[];
  /** How long the half was allowed, in seconds. */
  readonly limitSeconds: number;
  /**
   * Why the change was not planted, the check not started, or the workspace
   * not put back, when one of those is the reason.
   */
  readonly problem?: string;
}

/**
 * Write a number of seconds in words.
 * @param seconds - How many
 * @returns For example `1 second` or `120 seconds`
 */
function inSeconds(seconds: number): string {
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/**
 * Quote a list of declared texts.
 * @param texts - The texts
 * @returns Each in quotes, separated by `or`
 */
function quoted(texts: readonly string[]): string {
  return texts.map(text => JSON.stringify(text)).join(" or ");
}

/**
 * How the sentence of a check that could not be started begins. What follows
 * it is why, in the words of whatever stood in the way.
 */
export const NOT_STARTED_LEAD =
  "The check could not be started, so nothing was checked: ";

/** A half's sentence, by its reason. */
const HALF_SENTENCES: Readonly<
  Record<ProofHalfReason, (facts: HalfFacts) => string>
> = {
  "rejected-as-declared": () =>
    "The check turned this change away and printed the failure text the entry declares.",
  accepted: () => "The check let this change through.",
  "patch-not-applied": facts =>
    `The change in ${facts.patch} could not be put in place, so the check was not run. ${facts.problem ?? ""}`.trim(),
  "not-started": facts =>
    `${NOT_STARTED_LEAD}${facts.problem ?? "no reason was given"}.`,
  "timed-out": facts =>
    `The check was still running after ${inSeconds(facts.limitSeconds)}, the time one half of this proof is allowed, so it was stopped.`,
  killed: () =>
    "The check was stopped before it finished, so it gave no answer.",
  "nothing-measured": () =>
    "The check ran, but its own output says it measured nothing, so its answer cannot be relied on.",
  "wrong-reason": facts =>
    `The check turned this change away, but its output does not contain the failure text the entry declares (${quoted(facts.shape)}). It may have failed for another reason, such as a broken or missing tool.`,
  "no-failure-shape": () =>
    "The check turned this change away, but the entry declares no failure text (failure_shape), so a real rejection cannot be told apart from a broken tool. Add the text the check prints when it finds the rule broken.",
  "canary-merged": () =>
    "The canary pull request was merged into the base branch. Its required checks did not prevent the merge.",
  "workspace-not-restored": facts =>
    `This half was not run. An earlier change could not be taken back out of the workspace, so its files are no longer a clean copy. ${facts.problem ?? ""}`.trim(),
};

/**
 * Say what one half of a proof showed.
 * @param reason - Why it showed what it did
 * @param facts - What the sentence may quote
 * @returns One or two sentences for the operator
 */
export function halfDetail(reason: ProofHalfReason, facts: HalfFacts): string {
  return HALF_SENTENCES[reason](facts);
}

/** The sentence for each result that is decided by the two halves together. */
const VERDICT_SENTENCES: Partial<Record<ProofEntryReason, string>> = {
  proved:
    "The check turned the violating change away with the declared failure text and let the clean change through.",
  "violation-accepted":
    "The check let the violating change through, so it does not stop what it is there to stop.",
  "clean-rejected":
    "The check turned the clean change away, so it stops changes that do not break the rule.",
  "violation-accepted-clean-rejected":
    "The check let the violating change through and turned the clean change away.",
};

/**
 * Say what the two halves together showed.
 * @param reason - The entry's reason
 * @param unanswered - The half that gave no answer and its sentence, when the
 *   result is `unknown`
 * @param unanswered.half - Which half
 * @param unanswered.detail - Its sentence
 * @returns The sentence for the operator
 */
export function verdictDetail(
  reason: ProofEntryReason,
  unanswered?: { readonly half: ProofHalf; readonly detail: string }
): string {
  const sentence = VERDICT_SENTENCES[reason];
  if (sentence !== undefined) return sentence;
  return unanswered === undefined
    ? "The proof gave no answer that can be relied on."
    : `The ${HALF_NAMES[unanswered.half]} change gave no answer that can be relied on. ${unanswered.detail}`;
}

/** How every result that ran nothing begins. */
const NOT_RUN = "No proof was run.";

/** The reason of a pair one of whose changes edits what the check is. */
export const DECLARATION_CHANGED_REASON = "declaration-changed";

/** The reason of a pair one of whose changes touches an ignored path. */
export const IGNORED_PATH_REASON = "ignored-path";

/**
 * The reason a pair is turned away for what one of its changes touches.
 * `lisa controls proof-check` and `lisa controls attest` give the same one.
 * @param finding - What the change touches
 * @returns `ignored-path` for a path the repository ignores, and
 *   `declaration-changed` for everything that changes what the check is
 */
export function changeFindingReason(
  finding: ChangeFinding
): typeof DECLARATION_CHANGED_REASON | typeof IGNORED_PATH_REASON {
  return finding.kind === IGNORED_PATH_REASON
    ? IGNORED_PATH_REASON
    : DECLARATION_CHANGED_REASON;
}

/**
 * Say what a file a change may not edit is.
 * @param finding - What the change touches, other than an ignored path
 * @returns The words that follow the file's name
 */
function whatItIs(
  finding: Exclude<ChangeFinding, { readonly kind: typeof IGNORED_PATH_REASON }>
): string {
  if (finding.kind === "program") {
    return "the program this check's command starts";
  }
  if (finding.kind === "runner-manifest") {
    const programs = TASK_RUNNER_PROGRAMS[finding.runner].join(", ");
    return finding.runner === TASK_RUNNER_KINDS[0]
      ? `whose scripts this check's command runs (the command goes through a package manager: ${programs})`
      : `which says what this check's command runs (the command goes through ${programs})`;
  }
  return finding.file === GATES_DECLARATION_PATH
    ? "the file that says what each check runs"
    : "one of the files that start the checks at commit and push";
}

/**
 * Say what a change touches that a proof's change may not.
 * `lisa controls proof-check` and `lisa controls attest` both say it in
 * these words.
 * @param half - Which half's change
 * @param finding - What it touches
 * @returns The sentence
 */
export function changeFindingDetail(
  half: ProofHalf,
  finding: ChangeFinding
): string {
  const change = `The ${HALF_NAMES[half]} change`;
  return finding.kind === IGNORED_PATH_REASON
    ? `${change} touches ${finding.file}, a path this repository ignores. Git leaves an ignored file out of a commit, so the check would be shown a change without that file while its command finds the file on disk. Take that file out of the patch.`
    : `${change} edits ${finding.file}, ${whatItIs(finding)}. A proof never changes what the check is. Take that file out of the patch.`;
}

/**
 * Say that an entry's proof was not run because of what one of its changes
 * touches.
 * @param half - Which half's change
 * @param finding - What it touches
 * @returns The sentence for the operator
 */
export function pairChangesCheckDetail(
  half: ProofHalf,
  finding: ChangeFinding
): string {
  return `${NOT_RUN} ${changeFindingDetail(half, finding)}`;
}

/** One half an entry cannot plant, and why. */
export interface MissingHalf {
  readonly half: ProofHalf;
  /** The patch file the declaration names, or `null` when it names none. */
  readonly file: string | null;
}

/**
 * Say which halves of a proof are missing.
 * @param missing - The halves that cannot be planted
 * @returns The sentence for the operator
 */
export function missingHalvesDetail(missing: readonly MissingHalf[]): string {
  const each = missing.map(({ half, file }) =>
    file === null
      ? `there is no ${HALF_NAMES[half]} change to plant, because the gates declaration names no patch file for proof.${half}`
      : `there is no ${HALF_NAMES[half]} change to plant, because the patch file ${file} (proof.${half}) does not exist`
  );
  return `${NOT_RUN} A proof needs a violating change and a clean change, and ${each.join("; and ")}.`;
}

/**
 * Say why an entry is not enforced anywhere this runner can exercise.
 * @param moments - The moments the entry is enforced at
 * @param onPullRequests - Whether a pull request is one of them
 * @returns The sentence for the operator
 */
export function noMomentDetail(
  moments: readonly string[],
  onPullRequests: boolean
): string {
  if (onPullRequests) {
    return `${NOT_RUN} This entry is enforced on pull requests and not at commit or push. Whether a pull request is stopped is decided by the hosting platform, and this runner only exercises the commit and push moments.`;
  }
  return moments.length === 0
    ? `${NOT_RUN} This entry is not enforced at any moment, so there is nothing to exercise.`
    : `${NOT_RUN} This entry is enforced at ${moments.join(", ")} and not at commit or push, the two moments this runner exercises.`;
}

/**
 * Say that a proof reaches outside the repository and was not allowed to.
 * @param effects - What the proof says it does there
 * @returns The sentence for the operator
 */
export function externalEffectsDetail(effects: readonly string[]): string {
  return `${NOT_RUN} This proof says it does something outside the repository: ${quoted(effects).replaceAll(" or ", "; ")}. A proof like that is only run when the operator has agreed to it.`;
}

/**
 * Say that what measures an entry is not something this runner can start.
 * @param moment - The moment the proof would stand for
 * @param kind - The kind of mechanism found there
 * @returns The sentence for the operator
 */
export function notACommandDetail(moment: string, kind: string): string {
  return `${NOT_RUN} What measures this entry at ${moment} is not a command of its own (it is ${JSON.stringify(kind)}), so there is nothing this runner can start.`;
}

/**
 * Say that a patch file is there and was not read.
 * @param problem - Why it was not read
 * @returns The sentence for the operator
 */
export function unreadableDetail(problem: string): string {
  return `${NOT_RUN} ${problem}`;
}
