/**
 * Writing down what the audit report said, as evidence.
 *
 * Most requirements are served by no control in the register, so no proof
 * can be run for them. What is known about them is what the audit found. The
 * verdict is computed from the register and the evidence file and nothing
 * else, so that its digest covers everything it rests on; the attest step
 * therefore copies each finding of a report that passed every check into the
 * evidence file, as one record, dated when it read the report.
 *
 * ## At which rung
 *
 * Always `asserted`. An audit reads the repository and runs nothing, and its
 * own instructions say that finding a tool or a file shows that something
 * exists, not that it works. So a finding can make a requirement conforming
 * only where the catalogue says asserted evidence is enough. For every other
 * requirement it leaves the verdict at `unknown` until a control serves it.
 *
 * ## What each state becomes
 *
 * | finding | record's `result` |
 * | --- | --- |
 * | `exists-not-enforced` | `held`: the audit found it written down or checked |
 * | `missing` | `failed`: the audit found nothing that does it |
 * | `unknown`, `question` | `unknown` |
 * | `not-applicable` | `not-applicable`, with the finding's `what` as the fact |
 * | `proved` | no record: the finding only repeats a record already here |
 *
 * `reason` keeps the finding's state and `detail` its `what`, word for word.
 * @module controls/evidence-findings
 */
import type { AuditFinding, AuditFindingState } from "./audit-report-types.js";
import {
  findingRecordId,
  type EvidenceRecord,
  type EvidenceResult,
} from "./evidence-types.js";
import type { EvidenceStamp } from "./evidence-write.js";

/** What a finding in each state shows, or `null` when it gets no record. */
export const FINDING_RESULTS: Readonly<
  Record<AuditFindingState, EvidenceResult | null>
> = {
  proved: null,
  "exists-not-enforced": "held",
  missing: "failed",
  "not-applicable": "not-applicable",
  unknown: "unknown",
  question: "unknown",
};

/**
 * The evidence records for the findings of an audit report.
 * @param findings - The findings of a report that passed every check
 * @param stamp - The commit and the freshness lifetime of the run
 * @param readAt - When the attest step read the report
 * @returns One record per finding that says something of its own
 */
export function findingRecords(
  findings: readonly AuditFinding[],
  stamp: EvidenceStamp,
  readAt: Date
): readonly EvidenceRecord[] {
  const at = readAt.toISOString();
  return findings.flatMap((finding): readonly EvidenceRecord[] => {
    const result = FINDING_RESULTS[finding.state];
    return result === null
      ? []
      : [
          {
            id: findingRecordId(finding.criterion, finding.scope),
            criterion: finding.criterion,
            entry_id: null,
            scope: finding.scope,
            rung: "asserted",
            moment: null,
            result,
            reason: finding.state,
            detail: finding.what,
            commit: stamp.commit,
            command: null,
            exit_status: null,
            started_at: at,
            completed_at: at,
            freshness_seconds: stamp.freshnessSeconds,
            output_excerpt: "",
            output_truncated: false,
          },
        ];
  });
}
