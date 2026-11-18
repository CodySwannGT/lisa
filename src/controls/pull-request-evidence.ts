/**
 * What the hosting platform said about the pull-request moment, handed to
 * the evidence writer.
 *
 * Settling the pull-request moment (`./pull-request-settle.ts`) and writing
 * evidence (`./attest-record.ts`) are two steps. This module is the join:
 * it turns the settled part of a run into one `EvidenceBatch` for the
 * `pull-request` moment, and decides nothing about any control itself.
 *
 * ## Which point becomes which result
 *
 * Every point the platform was asked about gives one result at the
 * `observed` rung, from what its merge-protection settings said:
 *
 * | the settings say (`observed`) | `result` | `reason` |
 * | --- | --- | --- |
 * | `required` | `held` | `observed-required` |
 * | `not-required` | `failed` | `observed-not-required` |
 * | `unknown` | `unknown` | `merge-protection-unread` or `platform-not-reached` |
 * | `not-asked` | no result | |
 *
 * `not-asked` gives no result because nothing was looked at: the register
 * does not ask the platform to stop a merge for the entry, or no check name
 * derives from it. A record at the `observed` rung says something was read
 * where it is, and here nothing was. The entry then has no record at this
 * moment, exactly as an entry whose commit proof could not be run has none.
 *
 * A point whose canaries were run (`rung: "exercised"`) also gives one
 * result per half, mapped by the writer's own table (`proofHalfResult`): the
 * violating change turned away as declared and the clean change let through
 * are `held`, the opposite of either is `failed`, and no answer that can be
 * relied on is `unknown`.
 *
 * ## Each half is handed over once
 *
 * A canary half also sits in the run's `entries`, on the entry it settled.
 * The writer's own batch for the run takes only the halves of the moments
 * the paired-proof runner exercises (`proofRunBatch`), so the pull-request
 * halves reach the evidence file from here and from nowhere else.
 *
 * ## What a run replaces, and what it leaves
 *
 * A batch replaces every earlier record of the entries it names at the
 * moments it names. A run that was asked for canaries speaks for the whole
 * pull-request moment, so it names every entry: whatever it could not
 * exercise this time is left without an exercised record, not with an
 * earlier pass.
 *
 * A run that only read the settings planted nothing, so it has nothing to
 * say against a canary proof an earlier run recorded. Naming the entry would
 * remove that proof all the same, and a requirement that needs exercised
 * evidence would drop to `unknown` because someone ran the default command.
 * So such a run **leaves an entry out of the batch**, writing nothing about
 * it and removing nothing, when all of these hold:
 *
 * - the evidence file holds an answer a canary gave for the entry at the
 *   pull-request moment — a half that held or a half that failed;
 * - every record it holds for the entry at that moment is still within its
 *   lifetime;
 * - the settings did not say today that a check of the entry is not
 *   required.
 *
 * The earlier run's records then stand until they age out, and the first
 * default run after that replaces them with what it reads. When the settings
 * say the check is no longer required, the earlier proof describes a
 * platform that has changed: the entry is named, the proof goes, and the
 * `failed` observation takes its place. A canary failure is kept on the same
 * terms as a pass, so reading that the check is required never hides that
 * the check let a violating change through.
 * @module controls/pull-request-evidence
 */
import { isEvidenceFresh } from "./evidence.js";
import { parseEvidenceDocument } from "./evidence-document.js";
import type {
  EntryEvidenceResult,
  EvidenceBatch,
  EvidenceRecord,
  EvidenceResultInput,
} from "./evidence-types.js";
import { proofHalfResult } from "./evidence-write.js";
import { readEvidenceDocument } from "./proof-halves.js";
import type { ProofRun } from "./proof-types.js";
import {
  PULL_REQUEST_POINT_MOMENT,
  pullRequestSettlementOf,
  type ObservedState,
  type PullRequestPoint,
  type PullRequestSettlement,
} from "./pull-request-types.js";

/** The reason of an observed result whose check the platform requires. */
const OBSERVED_REQUIRED_REASON = "observed-required";

/** What each answer of the platform's settings shows about a control. */
const OBSERVED_RESULTS: Readonly<
  Record<Exclude<ObservedState, "not-asked">, EntryEvidenceResult>
> = {
  required: "held",
  "not-required": "failed",
  unknown: "unknown",
};

/**
 * Say that the platform requires an entry's checks, as a record keeps it.
 *
 * The point's own sentence cannot be used: once canaries were asked for it
 * speaks of them, and before that it tells the operator which option to run
 * next, which is not a fact about the platform.
 * @param point - The entry's pull-request point
 * @param branch - The branch whose settings were read, when one is known
 * @returns The sentence
 */
function requiredSentence(
  point: PullRequestPoint,
  branch: string | null
): string {
  const checks = point.checks
    .map(check => JSON.stringify(check.context))
    .join(" and ");
  return `The hosting platform requires ${checks} on ${branch ?? "the default branch"} before a pull request can be merged. That was read from its merge-protection settings; no change was planted to see the check turn one away.`;
}

/**
 * What the settings said about one entry, as a result at the observed rung.
 * @param point - The entry's pull-request point
 * @param branch - The branch whose settings were read, when one is known
 * @returns The result, or none when the platform was not asked
 */
function observedResults(
  point: PullRequestPoint,
  branch: string | null
): readonly EvidenceResultInput[] {
  if (point.observed === "not-asked") return [];
  const required = point.observed === "required";
  // A point whose canaries were run is dated when they finished. Its
  // settings were read before its first canary began, so that is the latest
  // the reading can have been.
  const readAt = point.halves[0]?.started_at ?? point.completed_at;
  return [
    {
      entry_id: point.entry_id,
      moment: PULL_REQUEST_POINT_MOMENT,
      rung: "observed",
      result: OBSERVED_RESULTS[point.observed],
      // Canaries are opened only for a check the settings require, so a
      // point that says anything else still carries the reading's own
      // reason and sentence.
      reason: required ? OBSERVED_REQUIRED_REASON : point.reason,
      detail: required ? requiredSentence(point, branch) : point.detail,
      command: null,
      exit_status: null,
      started_at: readAt,
      completed_at: readAt,
      output_excerpt: point.checks
        .map(check => `${JSON.stringify(check.context)}: ${check.state}`)
        .join("; "),
      output_truncated: false,
    },
  ];
}

/**
 * Tell whether a run that only read the settings leaves an entry's earlier
 * canary proof in place; see the module comment.
 * @param point - The entry's pull-request point from this run
 * @param settlement - What this run did about the pull-request moment
 * @param earlier - The records the evidence file held before this run
 * @param now - The current time
 * @returns Whether the entry is left out of the batch
 */
function standsOnEarlierProof(
  point: PullRequestPoint,
  settlement: PullRequestSettlement,
  earlier: readonly EvidenceRecord[],
  now: Date
): boolean {
  if (settlement.mode !== "observed" || point.observed === "not-required") {
    return false;
  }
  const onRecord = earlier.filter(
    record =>
      record.entry_id === point.entry_id &&
      record.moment === PULL_REQUEST_POINT_MOMENT
  );
  return (
    onRecord.some(
      record => record.rung === "exercised" && record.result !== "unknown"
    ) && onRecord.every(record => isEvidenceFresh(record, now))
  );
}

/**
 * Everything a run found out about the pull-request moment, as one batch.
 * @param settlement - What the run did and learned about pull requests
 * @param earlier - The records the evidence file held before this run
 * @param now - The current time, which decides which of them are current
 * @returns The batch for the `pull-request` moment
 */
export function pullRequestBatch(
  settlement: PullRequestSettlement,
  earlier: readonly EvidenceRecord[],
  now: Date
): EvidenceBatch {
  const spokenFor = settlement.points.filter(
    point => !standsOnEarlierProof(point, settlement, earlier, now)
  );
  return {
    entries: spokenFor.map(point => point.entry_id),
    moments: [PULL_REQUEST_POINT_MOMENT],
    results: spokenFor.flatMap(point => [
      ...observedResults(point, settlement.branch),
      ...(point.rung === "exercised"
        ? point.halves.map(half => proofHalfResult(half))
        : []),
    ]),
  };
}

/**
 * The batches an attest run hands the evidence writer for the pull-request
 * moment.
 *
 * The evidence file is read here, before the writer reads it again, only to
 * learn which canary proofs are still current. A file that is missing, is
 * reached through a link, or is not what the attest step writes counts as
 * holding nothing: the writer keeps nothing of such a file either.
 * @param run - The run, with its pull-request moment settled or not
 * @param context - Where the evidence file is, and the current time
 * @param context.root - Path of the repository the operator named
 * @param context.now - The current time
 * @returns One batch, or none when the register has no pull-request entry
 */
export function pullRequestBatches(
  run: ProofRun,
  context: { readonly root: string; readonly now: Date }
): readonly EvidenceBatch[] {
  const settlement = pullRequestSettlementOf(run);
  if (settlement === null) return [];
  const held = parseEvidenceDocument(readEvidenceDocument(context.root));
  return [
    pullRequestBatch(
      settlement,
      held.problems === null ? held.document.records : [],
      context.now
    ),
  ];
}
