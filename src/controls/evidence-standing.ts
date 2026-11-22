/**
 * Whether a record about a control is one a run could have written, and
 * written about the checks as they are.
 *
 * The evidence file is on disk between runs, and anyone can type into it.
 * So a record about a control counts only when all of this holds:
 *
 * 1. Its moment is one a run writes records for: `commit`, `push` or
 *    `pull-request`. No step writes a record at any other moment.
 * 2. Its entry is enforced at that moment. A pull-request proof of a check
 *    that does not run on pull requests is a proof of nothing.
 * 3. It was recorded under the digest of what defines the checks now
 *    (`./checks-binding.ts`). A record made when the checks were defined
 *    differently says how other checks behaved.
 *
 * The same three questions are asked in two places, and here is the one
 * answer both use. The writer asks them of every earlier record before it
 * keeps it (`./evidence-write.ts`). The verdict asks them of every record it
 * reads (`./verdict-answers.ts`), because a record typed into the file after
 * the last run has been through no writer. How long a record is relied on is
 * the fourth rule, and `evidenceExpiry` in `./evidence.ts` holds it for
 * every reader.
 * @module controls/evidence-standing
 */
import type { EvidenceRecord } from "./evidence-types.js";
import { PROOF_MOMENTS } from "./proof-types.js";
import { PULL_REQUEST_MOMENT } from "./pull-request-executor.js";
import type { ControlRegisterEntry } from "./register-types.js";

/**
 * The moments an attest run can write a record about a control for: the two
 * the paired-proof runner exercises, and the one the hosting platform
 * answers for. No step writes a record at any other moment, so a record that
 * names another one was not written by a run.
 */
export const EVIDENCE_MOMENTS: readonly string[] = [
  ...PROOF_MOMENTS,
  PULL_REQUEST_MOMENT,
];

/** One reason a record about a control does not count. */
export type StandingProblem =
  /** It names a moment no run writes records for, or none at all. */
  | "unknown-moment"
  /** Its entry is not enforced at the moment it names. */
  | "not-enforced-there"
  /** It was recorded when the checks were defined differently. */
  | "other-checks";

/**
 * Say why a record about a control does not count, when it does not.
 *
 * The digest is asked last, so `other-checks` means the digest is the only
 * thing in the way: a run could have written the record, about other checks.
 * @param record - A record about a control
 * @param entry - The register entry it names
 * @param checksDigest - The digest of what defines the checks now
 * @returns The reason, or `null` when the record counts
 */
export function standingProblem(
  record: Pick<EvidenceRecord, "moment" | "checks_digest">,
  entry: Pick<ControlRegisterEntry, "enforcement_points">,
  checksDigest: string
): StandingProblem | null {
  const { moment } = record;
  if (moment === null || !EVIDENCE_MOMENTS.includes(moment)) {
    return "unknown-moment";
  }
  if (!entry.enforcement_points.some(point => point.moment === moment)) {
    return "not-enforced-there";
  }
  return record.checks_digest === checksDigest ? null : "other-checks";
}
