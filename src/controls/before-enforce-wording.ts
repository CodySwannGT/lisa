/**
 * What a before-enforce run says to the person reading it.
 *
 * Every result carries a short code for a program and a sentence for a
 * person. The sentences are here, in one place, written for someone who does
 * not code: they say what was tried, what happened to it, and what that
 * means before anything has been installed.
 *
 * One sentence matters more than the rest and is said every time a clone was
 * made: a fresh clone runs no hook. That is not a caveat about this run. It
 * is the finding, because every new checkout of the repository starts the
 * same way.
 * @module controls/before-enforce-wording
 */
import type {
  BeforeEnforceCanary,
  BeforeEnforceCopy,
  BeforeEnforceCounts,
  BeforeEnforceOutcome,
  BeforeEnforceTool,
} from "./before-enforce-types.js";
import { carriedNotes, shortCommit } from "./proof-copy-wording.js";

/** How every result of an entry nothing was tried for begins. */
const NOT_EXERCISED = "Not exercised yet.";

/** How a proof plan's own sentence for the same situation begins. */
const PLAN_OPENING = /^No proof was run\.\s*/u;

/** What the two moments are called when something went through them. */
const WENT_THROUGH: Readonly<Record<string, string>> = {
  commit: "the commit was created",
  push: "the change arrived in the stand-in remote",
};

/** What the two moments are called when something did not. */
const STOPPED: Readonly<Record<string, string>> = {
  commit: "no commit was created",
  push: "the change did not arrive in the stand-in remote",
};

/**
 * Say a number of things in words, singular or plural.
 * @param count - How many
 * @param one - The word for one
 * @param many - The word for any other number
 * @returns For example `1 entry` or `3 entries`
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * Name the git command of an attempt, as a person would say it.
 * @param moment - `commit` or `push`
 * @returns `git commit` or `git push`
 */
function gitCommand(moment: string): string {
  return `git ${moment}`;
}

/**
 * Say that the violating change went through.
 * @param canary - The commit or push that was made
 * @returns The sentence
 */
export function acceptedSentence(canary: BeforeEnforceCanary): string {
  return `In a fresh clone of this repository nothing stopped the violating change: ${gitCommand(canary.moment)} exited ${String(canary.exit_status)} and ${WENT_THROUGH[canary.moment] ?? "the change went through"}.`;
}

/**
 * Say that something refused the violating change.
 * @param canary - The commit or push that was made
 * @returns The sentences
 */
export function rejectedDetail(canary: BeforeEnforceCanary): string {
  return `Something in a fresh clone of this repository refused the violating change: ${gitCommand(canary.moment)} exited ${String(canary.exit_status)} and ${STOPPED[canary.moment] ?? "the change did not go through"}. This run installs nothing, so what refused it is wiring the repository already has.`;
}

/**
 * Say what the tool's own command made of the violating change.
 * @param tool - What the command answered
 * @param moment - The moment the entry is checked at
 * @returns The sentence that follows the one about the change going through
 */
export function toolSentence(tool: BeforeEnforceTool, moment: string): string {
  const exit = `exited ${String(tool.exit_status)}`;
  if (tool.outcome === "rejected") {
    return `Run on the same change, the check's own command ${exit} and printed the failure text it declares. So the tool is there and catches this change, and nothing runs it at ${moment}.`;
  }
  if (tool.outcome === "accepted") {
    return `Run on the same change, the check's own command ${exit} and passed it. So the tool is there and nothing runs it at ${moment}, but this test change does not make it fail: the test change, or what the check looks for, needs correcting before it can show the check works.`;
  }
  return `Run on the same change, the check's own command ${exit}, so the tool is there and nothing runs it at ${moment}. ${tool.detail}`;
}

/**
 * Say that the change went through and the tool's own command gave no
 * answer.
 * @param canary - The commit or push that was made
 * @param why - Why the tool's command gave none
 * @returns The sentences
 */
export function toolNotRunDetail(
  canary: BeforeEnforceCanary,
  why: string
): string {
  return `${acceptedSentence(canary)} But the check's own command gave no answer on the same change here, so this run cannot say the tool is present. ${why}`;
}

/**
 * Say why an entry was not exercised, from the sentence the proof plan gives
 * for the same situation.
 * @param planned - The plan's sentence
 * @param halfMissing - Whether a violating or clean change is what is missing
 * @returns The sentence for the operator
 */
export function notExercisedDetail(
  planned: string,
  halfMissing: boolean
): string {
  const said = `${NOT_EXERCISED} ${planned.replace(PLAN_OPENING, "")}`;
  return halfMissing
    ? `${said} Until both test changes exist there is nothing to try. The enforce step writes them.`
    : said;
}

/**
 * Say why an entry declared optional was not exercised.
 * @param moment - The moment it is declared optional at
 * @returns The sentence for the operator
 */
export function optionalDetail(moment: string): string {
  return `${NOT_EXERCISED} This check is declared optional at ${moment}: it reports and never stops a ${moment}, so there is no refusal to look for, before or after the enforce step.`;
}

/**
 * Say that an entry was not tried because the copy could not be vouched for.
 * @param spoiled - Why it could not
 * @returns The sentence for the operator
 */
export function notRestoredDetail(spoiled: string): string {
  return `Nothing was tried for this entry. An earlier change could not be taken back out of the temporary copy, so its files are no longer a clean copy. ${spoiled}`;
}

/**
 * Say that the violating change could not be put in place.
 * @param patch - The patch file
 * @param problem - Why it could not
 * @returns The sentence for the operator
 */
export function notPlantedDetail(patch: string, problem: string): string {
  return `The violating change in ${patch} could not be put in place in the fresh clone, so nothing was tried. ${problem}`;
}

/**
 * Say that a commit or push gave no answer that can be believed.
 * @param moment - `commit` or `push`
 * @param why - What went wrong, in the words of whatever reported it
 * @returns The sentence for the operator
 */
export function unclearAttemptDetail(moment: string, why: string): string {
  return `The ${moment} of the violating change gave no answer that can be relied on: ${why}.`;
}

/**
 * The one line that says what the fresh clone was.
 * @param copy - What was measured in the clone
 * @returns The sentence
 */
export function freshCloneNote(copy: BeforeEnforceCopy): string {
  const wiring =
    copy.hooks_path === null && copy.hooks.length === 0
      ? "It has no hook: git copies commits into a clone, and never the hook settings or hook files of the checkout it was cloned from"
      : `It has this hook wiring of its own: core.hooksPath ${copy.hooks_path ?? "not set"}; hook files ${copy.hooks.length === 0 ? "none" : copy.hooks.join(", ")}`;
  return `The changes were tried in a fresh clone of the last commit (${shortCommit(copy.commit)}) with nothing installed by this run. ${wiring}. So what happens there is what happens in every new checkout of this repository until someone sets hooks up in it.`;
}

/** What a run never shows, whatever it found. */
export const BEFORE_ENFORCE_LIMITS: readonly string[] = [
  "This says what a fresh clone of the repository does. A hook that is switched on only in your own checkout (by a setting, or by a hook manager when an install step ran) is not in a fresh clone and is not part of this result; lisa controls reconcile reads what this checkout has wired.",
  "Only commit and push are tried. Whether a pull request is stopped is decided by the hosting platform and is not exercised here.",
  "The clone holds the last commit, not uncommitted work, apart from the files that describe the checks themselves.",
  "An entry reads enforced when its violating change was refused. Whether a clean change still gets through is what the full proof shows: lisa controls attest, after the enforce step.",
  "This is a diagnosis made before anything is installed, not a Level 1 result. Nothing was written: no evidence, no register, no verdict, and no entry's unproved mark was set or cleared.",
];

/**
 * What the operator is told before the results when the working copy holds
 * work that is not committed.
 * @param copy - What was measured in the clone
 * @returns One sentence per line; none when everything is committed
 */
export function beforeEnforceNotes(
  copy: Pick<BeforeEnforceCopy, "commit" | "carried" | "uncommitted_work">
): readonly string[] {
  return copy.uncommitted_work
    ? [
        `This repository has changes that are not committed. This run does not use them: it works in a temporary copy of the last commit (${shortCommit(copy.commit)}), which is removed afterwards. Nothing is written in this repository.`,
        ...carriedNotes(copy.carried),
      ]
    : [];
}

/** The sentence for each outcome that needs no counting. */
const SETTLED_REASONS: Partial<Record<BeforeEnforceOutcome, string>> = {
  "nothing-declared":
    "The control register has no entries, so there is nothing to try. Declare the checks first (the configure step).",
};

/**
 * Say what a whole run came to.
 * @param outcome - What it came to
 * @param counts - How many entries came out as each result
 * @returns The sentence for the operator
 */
export function runReason(
  outcome: BeforeEnforceOutcome,
  counts: BeforeEnforceCounts
): string {
  const settled = SETTLED_REASONS[outcome];
  if (settled !== undefined) return settled;
  const total =
    counts["not-enforced"] +
    counts.enforced +
    counts["not-exercised"] +
    counts.unknown;
  const parts = [
    `${String(counts["not-enforced"])} of ${counted(total, "entry", "entries")} ${counts["not-enforced"] === 1 ? "exists and is" : "exist and are"} not enforced: a change that breaks the rule went through at commit or push in a fresh clone`,
    `${String(counts.enforced)} already enforced`,
    `${String(counts["not-exercised"])} not exercised yet`,
    `${String(counts.unknown)} gave no answer`,
  ];
  return `${parts.join("; ")}.`;
}
