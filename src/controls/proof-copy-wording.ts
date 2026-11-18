/**
 * What the disposable copy says to the person reading a proof's results.
 *
 * A proof that goes through a real commit or push can come to nothing for
 * reasons the paired-proof runner never meets when it starts a command
 * directly: nothing runs a hook in the copy, the check is declared optional,
 * or git said one thing while the gate runner's report said another. Each of
 * those is reported as a check that could not be started, with one of the
 * sentences here saying why. They are written to follow the words "so nothing
 * was checked:", so none of them ends with a full stop.
 *
 * The notes at the end are what the command says before the results when the
 * operator has work that is not committed.
 * @module controls/proof-copy-wording
 */
import { CARRIER_HOOKS, type CarrierMoment } from "./carrier-types.js";

/** What stands in for the stand-in remote's path in every kept text. */
export const PROOF_REMOTE_PLACEHOLDER = "<proof-remote>";

/** The message of the commit the copy is reset to, when one is needed. */
export const BASE_COMMIT_MESSAGE =
  "chore: prepare the disposable copy for control proofs";

/** How many characters of a commit id are shown to a person. */
const SHORT_COMMIT = 7;

/**
 * The message of the commit that carries one planted change.
 * @param entryId - The register entry being proved
 * @returns The message
 */
export function proofCommitMessage(entryId: string): string {
  return `chore: control proof for ${entryId}`;
}

/**
 * Take the full stop off the end of a sentence, so it can be quoted inside
 * another.
 * @param sentence - The sentence
 * @returns The sentence without trailing full stops or spaces
 */
function unstopped(sentence: string): string {
  const trimmed = sentence.trim();
  return trimmed.endsWith(".") ? unstopped(trimmed.slice(0, -1)) : trimmed;
}

/**
 * Why a check that is optional at a moment is not proved through the hook.
 * @param moment - The moment
 * @returns The reason
 */
export function optionalDetail(moment: CarrierMoment): string {
  return `this check is declared optional at ${moment}, so it reports and never stops a ${moment}; a proof through the hook has no rejection to observe`;
}

/**
 * Why nothing was proved at a moment no hook runs at in the copy.
 * @param moment - The moment
 * @param reason - What the carrier installer said about the copy
 * @returns The reason
 */
export function unwiredDetail(moment: CarrierMoment, reason: string): string {
  return `git runs no ${CARRIER_HOOKS[moment]} hook in the disposable copy, so there was nothing to prove this check through, and its command was not run on its own instead. The carrier installer said of the copy: ${unstopped(reason)}`;
}

/**
 * Why a change that could not be committed was never pushed.
 * @param said - What git said
 * @returns The reason
 */
export function notCommittedDetail(said: string): string {
  return `the change could not be committed in the disposable copy, so there was nothing to push (${unstopped(said)})`;
}

/**
 * Why an answer is not believed when git's exit status and what git did
 * disagree.
 * @param moment - The moment
 * @param code - Git's exit status
 * @returns The reason
 */
export function contradictionDetail(
  moment: CarrierMoment,
  code: number
): string {
  const landed =
    moment === "commit"
      ? "the commit was created"
      : "the change arrived in the stand-in remote";
  const absent =
    moment === "commit"
      ? "created no commit in the disposable copy"
      : "the change did not arrive in the stand-in remote";
  return code === 0
    ? `git ${moment} reported success but ${absent}, so nothing shows the change was let through`
    : `git ${moment} exited ${String(code)} although ${landed}, so the hook neither stopped the change nor let it through cleanly`;
}

/**
 * Why an answer is not counted when the gate runner's own report does not
 * say what git's exit status suggests about this check.
 * @param moment - The moment
 * @param refused - Whether git refused the commit or push
 * @param name - What the gate runner calls the check
 * @returns The reason
 */
export function unattributedDetail(
  moment: CarrierMoment,
  refused: boolean,
  name: string
): string {
  return refused
    ? `git refused the ${moment}, but the gate runner's report does not show ${name} failing, so the refusal came from something else in the hook and says nothing about this check`
    : `git let the ${moment} through, but the gate runner's report does not show ${name} passing, so this check did not judge the change`;
}

/**
 * What the operator is told before the results when the working copy holds
 * work that is not committed.
 * @param commit - The commit the proofs run against
 * @param carried - The files taken from the working copy because they differ
 *   from that commit
 * @returns One sentence per line; none when there is nothing to say
 */
export function uncommittedNotes(
  commit: string,
  carried: readonly string[]
): readonly string[] {
  return [
    `This repository has changes that are not committed. The proofs do not use them: they run in a temporary copy of the last commit (${commit.slice(0, SHORT_COMMIT)}), which is removed afterwards. Nothing in this repository is changed.`,
    ...(carried.length === 0
      ? []
      : [
          `The copy does take ${carried.length === 1 ? "this file" : "these files"} as ${carried.length === 1 ? "it is" : "they are"} in your working copy, because ${carried.length === 1 ? "it describes" : "they describe"} the checks themselves: ${carried.join(", ")}.`,
        ]),
  ];
}
