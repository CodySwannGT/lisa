/**
 * The decision table of a paired proof.
 *
 * Two questions and no others. What did one half show, given what the check
 * answered? And what do the two halves together say about the control? Both
 * are answered from observations alone, so the same observations always give
 * the same result, and nothing here starts a process, reads a file or looks
 * at a clock.
 *
 * ## What counts as a rejection
 *
 * A check that exits non-zero has not necessarily found the rule broken. A
 * missing configuration file, a crashed tool and a planted violation all end
 * in a non-zero exit, and only one of them says the control works. So a half
 * is `rejected` only when the gate runner itself reads the answer as a
 * measured failure and the output carries the failure text the entry
 * declares. Every other non-zero exit is `unknown`.
 *
 * An entry that declares no failure text can therefore never show a
 * rejection: there is nothing to tell its planted violation from a broken
 * tool. Its violating half is still worth running, because a violating change
 * that is let through is a failure whatever the entry declares.
 * @module controls/proof-judgement
 */
import type {
  ProofAnswer,
  ProofEntryReason,
  ProofHalf,
  ProofHalfOutcome,
  ProofHalfReason,
  ProofJudgement,
  ProofOutcome,
} from "./proof-types.js";

/** What one half showed, and why. */
export interface HalfObservation {
  readonly outcome: ProofHalfOutcome;
  readonly reason: ProofHalfReason;
}

/** What the two halves say about a control. */
export interface EntryVerdict {
  readonly outcome: ProofOutcome;
  /** The halves that failed. Empty unless the outcome is `failed`. */
  readonly failed_halves: readonly ProofHalf[];
  readonly reason: ProofEntryReason;
}

/**
 * Give a half no answer, for a reason.
 * @param reason - Why it has none
 * @returns The observation
 */
function unknown(reason: ProofHalfReason): HalfObservation {
  return { outcome: "unknown", reason };
}

/**
 * Say why a check that never ran to an end gave no answer.
 * @param answer - What the check answered
 * @param judgement - The gate runner's reading of that answer
 * @returns The observation, or `null` when the check did run to an end
 */
function neverAnswered(
  answer: ProofAnswer,
  judgement: ProofJudgement
): HalfObservation | null {
  if (answer.notStarted !== undefined) return unknown("not-started");
  if (answer.timedOut === true) return unknown("timed-out");
  return judgement.verdict === "killed" || answer.code === null
    ? unknown("killed")
    : null;
}

/**
 * Say what a check that exited non-zero showed.
 * @param judgement - The gate runner's reading of the answer
 * @param shape - The failure text the entry declares
 * @returns The observation
 */
function refused(
  judgement: ProofJudgement,
  shape: readonly string[]
): HalfObservation {
  if (shape.length === 0) return unknown("no-failure-shape");
  if (!judgement.declared) return unknown("wrong-reason");
  return judgement.verdict === "failed"
    ? { outcome: "rejected", reason: "rejected-as-declared" }
    : unknown("nothing-measured");
}

/**
 * Say what one half of a proof showed.
 * @param answer - What the check answered
 * @param judgement - The gate runner's reading of that answer
 * @param shape - The failure text the entry declares; empty when it declares
 *   none
 * @returns Whether the change was rejected or accepted, or why that is not
 *   known
 */
export function observeHalf(
  answer: ProofAnswer,
  judgement: ProofJudgement,
  shape: readonly string[]
): HalfObservation {
  const silent = neverAnswered(answer, judgement);
  if (silent !== null) return silent;
  if (judgement.verdict === "passed") {
    return { outcome: "accepted", reason: "accepted" };
  }
  // Exit 0 the gate runner does not believe: the check said it ran nothing.
  return answer.code === 0
    ? unknown("nothing-measured")
    : refused(judgement, shape);
}

/** The reason an entry failed, by which halves failed. */
const FAILURE_REASONS: Readonly<Record<string, ProofEntryReason>> = {
  violation: "violation-accepted",
  clean: "clean-rejected",
  "violation,clean": "violation-accepted-clean-rejected",
};

/**
 * Say what the two halves of a proof say about a control.
 *
 * It passes in exactly one case: the violating change rejected and the clean
 * change accepted. A violating change that was accepted and a clean change
 * that was rejected are each a failure, and a failure is reported even when
 * the other half gave no answer, because it is true either way. Everything
 * else is `unknown`, for the reason the first unanswered half gives.
 * @param violation - What the violating half showed
 * @param clean - What the clean half showed
 * @returns The entry's result
 */
export function entryVerdict(
  violation: HalfObservation,
  clean: HalfObservation
): EntryVerdict {
  const failed: readonly ProofHalf[] = [
    ...(violation.outcome === "accepted" ? (["violation"] as const) : []),
    ...(clean.outcome === "rejected" ? (["clean"] as const) : []),
  ];
  if (failed.length > 0) {
    return {
      outcome: "failed",
      failed_halves: failed,
      reason: FAILURE_REASONS[failed.join(",")] ?? "violation-accepted",
    };
  }
  if (violation.outcome === "rejected" && clean.outcome === "accepted") {
    return { outcome: "passed", failed_halves: [], reason: "proved" };
  }
  return {
    outcome: "unknown",
    failed_halves: [],
    reason: violation.outcome === "unknown" ? violation.reason : clean.reason,
  };
}
