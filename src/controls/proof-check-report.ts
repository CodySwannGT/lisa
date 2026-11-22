/**
 * Putting a `lisa controls proof-check` run together, and the lines a
 * person reads about it.
 *
 * The result is one document for a program and a few lines for a person,
 * and both say the same thing: which parts have a pair that is ready, which
 * do not and what to change, and which declare none. Everything depends only
 * on the parts' results, so the same results always give the same words.
 * @module controls/proof-check-report
 */
import { beforeEnforceNotes } from "./before-enforce-wording.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import {
  PROOF_CHECK_RESULTS,
  PROOF_CHECK_SCHEMA_VERSION,
  type ProofCheckCopy,
  type ProofCheckCounts,
  type ProofCheckOutcome,
  type ProofCheckPart,
  type ProofCheckResult,
  type ProofCheckRun,
} from "./proof-check-types.js";

/** The command's name, as every line it prints begins. */
export const PROOF_CHECK_NAME = "proof-check";

/** How a part's result reads in a line. */
const RESULT_WORDS: Readonly<Record<ProofCheckResult, string>> = {
  ready: "is ready",
  "not-ready": "is not ready",
  "no-proof": "has no proof",
};

/**
 * Write a count with its noun.
 * @param count - How many
 * @param one - The noun for one
 * @param many - The noun for any other number
 * @returns For example `1 check` or `3 checks`
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * Say what a run that checked nothing found to check.
 * @param parts - How many parts are declared
 * @param shipped - How many declared checks are not parts
 * @returns The sentence
 */
function nothingToCheck(parts: number, shipped: number): string {
  if (parts > 0) {
    return `None of the ${counted(parts, "declared check has", "declared checks has")} a paired proof, so there was nothing to check and each stays unproved.`;
  }
  return shipped === 0
    ? `No check is declared in ${GATES_DECLARATION_PATH}, so there is no paired proof to check.`
    : `No paired proof is declared in ${GATES_DECLARATION_PATH}. The project type supplies ${counted(shipped, "check that still needs", "checks that still need")} a paired proof.`;
}

/**
 * Say what a whole run came to.
 * @param outcome - What it came to
 * @param counts - How many parts got each result
 * @param shipped - How many declared checks are not parts
 * @returns The sentence
 */
function runReason(
  outcome: ProofCheckOutcome,
  counts: ProofCheckCounts,
  shipped: number
): string {
  const withProof = counts.ready + counts["not-ready"];
  const total = withProof + counts["no-proof"];
  if (outcome === "nothing-to-check") return nothingToCheck(total, shipped);
  const without =
    counts["no-proof"] === 0
      ? ""
      : ` ${counted(counts["no-proof"], "check declares", "checks declare")} no proof and ${counts["no-proof"] === 1 ? "stays" : "stay"} unproved.`;
  const beyond =
    shipped === 0
      ? ""
      : ` ${counted(shipped, "more check still needs", "more checks still need")} a paired proof.`;
  const head =
    outcome === "ready"
      ? `${counted(withProof, "paired proof is", "paired proofs are")} ready: on each, the check failed on the violating change with its declared failure text and passed on the clean change.`
      : `${String(counts["not-ready"])} of ${counted(withProof, "paired proof is", "paired proofs are")} not ready. Each one's "detail" says what to change.`;
  return `${head}${without}${beyond}`;
}

/**
 * Put part results together as one run.
 * @param found - What the run found
 * @param found.parts - One result per declared part, in register order
 * @param found.copy - The temporary copy, or `null` when none was made
 * @param found.shipped - How many declared checks are not parts
 * @returns The run
 */
export function proofCheckRunOf(found: {
  readonly parts: readonly ProofCheckPart[];
  readonly copy: ProofCheckCopy | null;
  readonly shipped: number;
}): ProofCheckRun {
  const { parts } = found;
  const counts = Object.fromEntries(
    PROOF_CHECK_RESULTS.map(result => [
      result,
      parts.filter(part => part.result === result).length,
    ])
  ) as ProofCheckCounts;
  const ready: ProofCheckOutcome =
    counts.ready > 0 ? "ready" : "nothing-to-check";
  const outcome = counts["not-ready"] > 0 ? "not-ready" : ready;
  return {
    schema_version: PROOF_CHECK_SCHEMA_VERSION,
    outcome,
    reason: runReason(outcome, counts, found.shipped),
    copy: found.copy,
    counts,
    parts,
  };
}

/**
 * The lines a person reads about a run: what the copy was, one line per
 * part, then what the run came to.
 * @param run - The run
 * @returns The lines, the summary last
 */
export function proofCheckLines(run: ProofCheckRun): readonly string[] {
  const notes =
    run.copy === null
      ? []
      : beforeEnforceNotes(run.copy).map(note => `note. ${note}`);
  const parts = run.parts.flatMap(part => [
    `${part.entry_id} ${RESULT_WORDS[part.result]}. ${part.detail}`,
    ...(part.note === null ? [] : [`${part.entry_id} note. ${part.note}`]),
  ]);
  const word = run.outcome.toUpperCase().replaceAll("-", " ");
  return [...notes, ...parts, `${word}. ${run.reason}`].map(
    line => `${PROOF_CHECK_NAME}: ${line}`
  );
}
