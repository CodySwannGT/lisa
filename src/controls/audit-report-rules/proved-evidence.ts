/**
 * Rule: `proved` is never accepted on presence alone.
 *
 * Finding a tool or a file shows that a control exists, not that it works.
 * Only the attest step can show that, by exercising the control and writing an
 * evidence record. So a finding may say `proved` only when it cites a record
 * that is in the evidence file, was recorded for the same criterion, and is
 * still within its freshness lifetime. The audit never writes that state
 * itself; it can only copy it from a record that is already there.
 * @module controls/audit-report-rules/proved-evidence
 */
import type {
  AuditFinding,
  AuditReportContext,
  AuditReportRule,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";
import { EVIDENCE_PATH, evidenceExpiry, isEvidenceFresh } from "../evidence.js";

/** The name this rule's violations carry. */
export const PROVED_EVIDENCE_RULE = "proved-evidence";

const OR_CHOOSE = "or choose another state";

/**
 * Say why a `proved` finding is not backed by evidence.
 * @param finding - A finding in state `proved`
 * @param context - The facts it is checked against
 * @returns The reason, or `null` when fresh evidence backs it
 */
function unbacked(
  finding: AuditFinding,
  context: AuditReportContext
): string | null {
  const id = finding.evidence_id;
  if (id === undefined) {
    return `This finding says the requirement is proved but cites no evidence record. Only the attest step can prove a requirement: cite the record it wrote in "evidence_id", ${OR_CHOOSE}.`;
  }
  const record = context.evidence.find(candidate => candidate.id === id);
  if (record === undefined) {
    return `This finding cites evidence record "${id}", but ${EVIDENCE_PATH} holds no usable record with that id. Run the attest step, ${OR_CHOOSE}.`;
  }
  if (record.criterion !== finding.criterion) {
    return `Evidence record "${id}" was recorded for a different requirement, so it cannot prove this one. Cite a record for this requirement, ${OR_CHOOSE}.`;
  }
  if (isEvidenceFresh(record, context.now)) return null;
  return Date.parse(record.completed_at) > context.now.getTime()
    ? `Evidence record "${id}" is dated later than the current time, so it cannot be relied on. Run the attest step again, ${OR_CHOOSE}.`
    : `Evidence record "${id}" is too old to rely on: it stopped being current at ${evidenceExpiry(record).toISOString()}. Run the attest step again, ${OR_CHOOSE}.`;
}

/**
 * Every `proved` finding cites a fresh evidence record for its own criterion.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const provedNeedsFreshEvidence: AuditReportRule = (report, context) =>
  report.findings
    .filter(finding => finding.state === "proved")
    .flatMap(finding => {
      const reason = unbacked(finding, context);
      return reason === null
        ? []
        : [
            findingViolation(
              PROVED_EVIDENCE_RULE,
              finding,
              reason,
              "evidence_id"
            ),
          ];
    });
