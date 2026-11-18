/**
 * What `lisa controls proof-check` says to whoever wrote the patches.
 *
 * The reader is an agent writing a violating change and a clean change for a
 * tool Lisa knows nothing about, and it acts on these sentences. So each one
 * says exactly what is wrong and what to change, in plain words, and none of
 * them needs the code read beside it. They live here in one place so they
 * stay consistent with each other.
 * @module controls/proof-check-wording
 */
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import type { ProofHalf } from "./proof-halves.js";
import { PROOF_FOLDER } from "./proof-patch.js";
import { HALF_NAMES, NOT_STARTED_LEAD } from "./proof-wording.js";
import { WHOLE_REPOSITORY_SCOPE } from "./register-types.js";

/** The option that lets a proof that reaches outside the repository run. */
export const ACKNOWLEDGE_FLAG = "--acknowledge-external-effects";

/**
 * Quote a list of declared texts.
 * @param texts - The texts
 * @returns Each in quotes, separated by `or`
 */
function quoted(texts: readonly string[]): string {
  return texts.map(text => JSON.stringify(text)).join(" or ");
}

/**
 * Name a part's folder the way a sentence reads.
 * @param scope - The part's scope
 * @returns `the folder api`, or `the repository` for the whole of it
 */
function folderOf(scope: string): string {
  return scope === WHOLE_REPOSITORY_SCOPE
    ? "the repository"
    : `the folder ${scope}`;
}

/**
 * Write a number of seconds in words.
 * @param seconds - How many
 * @returns For example `1 second` or `120 seconds`
 */
function inSeconds(seconds: number): string {
  return `${String(seconds)} ${seconds === 1 ? "second" : "seconds"}`;
}

/** The sentence of a part whose pair works. */
export const READY_DETAIL =
  "The check failed on the violating change with the declared failure text and passed on the clean change.";

/** The sentence of a part that declares no proof at all. */
export const NO_PROOF_DETAIL = `This check declares no paired proof, so it stays unproved. Write a violating change and a clean change as patch files under ${PROOF_FOLDER}/ and name them in the part's proof (proof.violation and proof.clean), with the failure text in proof.failure_shape.`;

/**
 * Say that one half names a patch file and the other names none.
 * @param missing - The half that names none
 * @returns The sentence
 */
export function halfNotDeclaredDetail(missing: ProofHalf): string {
  const other: ProofHalf = missing === "clean" ? "violation" : "clean";
  return `This check declares a ${HALF_NAMES[other]} change and no ${HALF_NAMES[missing]} change. A proof needs both. Write the ${HALF_NAMES[missing]} change as a patch file under ${PROOF_FOLDER}/ and name it in proof.${missing}.`;
}

/**
 * Say that a declared patch file is not there.
 * @param half - Which half
 * @param file - The patch file the declaration names
 * @returns The sentence
 */
export function patchMissingDetail(half: ProofHalf, file: string): string {
  return `The patch file ${file} (proof.${half}) does not exist. Write the ${HALF_NAMES[half]} change to that file, or correct the path in proof.${half}.`;
}

/**
 * Say that a declared patch file is there and was not read.
 * @param half - Which half
 * @param problem - Why it was not read, with what to do about it
 * @returns The sentence
 */
export function patchUnreadableDetail(
  half: ProofHalf,
  problem: string
): string {
  return `The ${HALF_NAMES[half]} change could not be read. ${problem}`;
}

/**
 * Say that both patch files hold the same change.
 * @param violation - The violating change's patch file
 * @param clean - The clean change's patch file
 * @returns The sentence
 */
export function identicalDetail(violation: string, clean: string): string {
  return `The violating change and the clean change are the same change: ${violation} and ${clean} hold the same patch. Make one a change that breaks the rule and the other a change the check accepts.`;
}

/** The sentence of a proof with no failure text. */
export const NO_FAILURE_TEXT_DETAIL =
  "This check declares no failure text (proof.failure_shape), so a real rejection could never be told apart from a broken tool. Add the text the tool prints when it finds the rule broken.";

/**
 * Say that what measures a part is not a command.
 * @param kind - The kind of mechanism found
 * @returns The sentence
 */
export function notACommandDetail(kind: string): string {
  return `What measures this check is not a command of its own (it is ${JSON.stringify(kind)}), so there is nothing to run the two changes against. Declare the check as a part with a command.`;
}

/**
 * Say that a proof reaches outside the repository and was not run.
 * @param effects - What the proof says it does there
 * @returns The sentence
 */
export function externalEffectsDetail(effects: readonly string[]): string {
  return `This proof says it does something outside the repository (${quoted(effects).replaceAll(" or ", "; ")}), so it was not run. Run this again with ${ACKNOWLEDGE_FLAG} once the operator has agreed to that.`;
}

/**
 * Say that a change does not apply to the last commit.
 * @param half - Which half
 * @param file - Its patch file
 * @param problem - Git's reason
 * @returns The sentence
 */
export function notAppliedDetail(
  half: ProofHalf,
  file: string,
  problem: string
): string {
  return `The ${HALF_NAMES[half]} change (${file}) does not apply to the last commit. ${problem} Make the patch again from the last commit, with nothing else changed.`;
}

/**
 * Say that a change edits the file that declares the checks.
 * @param half - Which half
 * @returns The sentence
 */
export function declarationChangedDetail(half: ProofHalf): string {
  return `The ${HALF_NAMES[half]} change edits ${GATES_DECLARATION_PATH}, the file that says what each check runs. A proof never changes what the check is. Take that file out of the patch.`;
}

/**
 * Say that a change leaves nothing git would commit.
 * @param half - Which half
 * @param scope - The part's folder
 * @returns The sentence
 */
export function noChangeDetail(half: ProofHalf, scope: string): string {
  return `The ${HALF_NAMES[half]} change changes no file that git would commit, so there is nothing for the check to look at. Change a file in ${folderOf(scope)} that git tracks, or add one it does not ignore.`;
}

/**
 * Say that a change touches nothing inside the part's own folder.
 * @param half - Which half
 * @param scope - The part's folder
 * @returns The sentence
 */
export function outsideFolderDetail(half: ProofHalf, scope: string): string {
  return `The ${HALF_NAMES[half]} change does not touch any file inside the folder ${scope}, so the check for ${scope} would never start. Change a file under ${scope}.`;
}

/**
 * Say that the command could not be started on a change.
 * @param half - Which half
 * @param toolDetail - The sentence the command's own record carries, which
 *   says why and, where it can, what to do
 * @returns The sentence
 */
export function notStartedDetail(half: ProofHalf, toolDetail: string): string {
  const why = toolDetail.startsWith(NOT_STARTED_LEAD)
    ? toolDetail.slice(NOT_STARTED_LEAD.length)
    : toolDetail;
  return `The check could not be started on the ${HALF_NAMES[half]} change, so nothing was checked: ${why} The check runs in a copy of the last commit, so what it needs has to be committed or installed on this machine.`;
}

/**
 * Say that the command was still running at the time limit.
 * @param half - Which half
 * @param limitSeconds - How long it was allowed
 * @param ceilingSeconds - The longest a proof may be allowed
 * @returns The sentence
 */
export function timedOutDetail(
  half: ProofHalf,
  limitSeconds: number,
  ceilingSeconds: number
): string {
  return `The check was still running on the ${HALF_NAMES[half]} change after ${inSeconds(limitSeconds)} and was stopped. Make the change one the check gets through sooner, or allow more time in proof.timeout_seconds (at most ${String(ceilingSeconds)}).`;
}

/**
 * Say that the command was stopped before it answered.
 * @param half - Which half
 * @returns The sentence
 */
export function killedDetail(half: ProofHalf): string {
  return `The check was stopped before it finished on the ${HALF_NAMES[half]} change, so it gave no answer. Run this again.`;
}

/**
 * Say that the command ran and measured nothing.
 * @param half - Which half
 * @returns The sentence
 */
export function nothingMeasuredDetail(half: ProofHalf): string {
  return `The check ran on the ${HALF_NAMES[half]} change, but its own output says it looked at nothing (no files, or no tests), so its answer cannot be relied on. Make the change one the check really reads.`;
}

/** The sentence of a violating change the check let through. */
export const VIOLATION_ACCEPTED_DETAIL =
  "The check passed on the violating change, so it does not catch it. Make the change break the rule the check enforces.";

/**
 * Say that the check failed on the violating change without its declared
 * text.
 * @param shape - The failure text the entry declares
 * @returns The sentence
 */
export function wrongFailureTextDetail(shape: readonly string[]): string {
  return `The check failed on the violating change but did not print the failure text this entry declares (${quoted(shape)}). Declare text the tool really prints when it fails.`;
}

/**
 * Say that the check failed on the clean change.
 * @param asDeclared - Whether it printed the declared failure text
 * @returns The sentence
 */
export function cleanRejectedDetail(asDeclared: boolean): string {
  const base =
    "The check failed on the clean change. A clean change must be one the check accepts.";
  return asDeclared
    ? base
    : `${base} It did not print the declared failure text, so it may have failed for another reason, such as a tool that is not installed.`;
}

/**
 * Say that the declared failure text also appears when the check passes.
 * @param shape - The failure text the entry declares
 * @returns The sentence
 */
export function failureTextOnCleanDetail(shape: readonly string[]): string {
  return `The check passed on the clean change, but what it printed holds the failure text this entry declares (${quoted(shape)}), so that text does not tell a failure from a pass. Declare text the tool prints only when it fails.`;
}

/** The start of every note about what the attest step will do. */
const ATTEST = '"lisa controls attest"';

/**
 * Say that a check that runs before a merge is proved another way.
 * @returns The note
 */
export function pullRequestNote(): string {
  return `This check runs on pull requests and not at commit or push, so ${ATTEST} tries this proof only when it is run with --pull-request-canaries.`;
}

/**
 * Say that a check has no moment the attest step can try it at.
 * @returns The note
 */
export function noMomentNote(): string {
  return `This check does not run at commit, at push or on pull requests, so ${ATTEST} has no moment to try this proof at.`;
}

/**
 * Say that a check that only reports cannot be proved to refuse.
 * @param moment - The moment it is optional at
 * @returns The note
 */
export function optionalNote(moment: string): string {
  return `This check is optional at ${moment}: it reports and never refuses, so ${ATTEST} cannot prove it there. It counts once a failure at ${moment} is required to stop the change.`;
}
