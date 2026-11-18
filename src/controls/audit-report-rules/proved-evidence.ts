/**
 * Rule: `proved` is never accepted on presence alone.
 *
 * Finding a tool or a file shows that a control exists, not that it works.
 * Only the attest step can show that, by exercising the control and writing an
 * evidence record. So a finding may say `proved` only when it cites a record
 * that is in the evidence file, is still within its freshness lifetime, and
 * is a record of the very thing the finding claims:
 *
 * - for the same requirement;
 * - for the same folder. A record about the whole repository speaks for
 *   every folder, as it does when the verdict is worked out; a record about
 *   one folder says nothing about another, or about the repository as a
 *   whole;
 * - at least as strongly known as the requirement asks for. Each requirement
 *   names the weakest rung that meets it, and the verdict holds evidence to
 *   it. A record that only looked at something (a merge setting read from
 *   the hosting platform is `observed`) cannot make the report say `proved`
 *   for a requirement that needs a change to have been tried (`exercised`),
 *   when the verdict would not count it as met. A record that does not say
 *   how strongly it is known reaches no rung;
 * - and, when it is one half of a paired proof, with the other half on
 *   record too, held and still current, for the same control at the same
 *   moment. A control is proved by refusing a change that breaks the rule
 *   *and* accepting one that does not. Either half alone shows nothing: a
 *   check that accepts everything passes the clean half.
 *
 * The audit never writes that state itself; it can only copy it from a
 * record that is already there. A finding in any other state cites no
 * record: an `evidence_id` on it is refused, because nothing checks a
 * citation that proves nothing and a reader would take it for proof.
 * @module controls/audit-report-rules/proved-evidence
 */
import {
  REPOSITORY_SCOPE,
  type AuditFinding,
  type AuditReportContext,
  type AuditReportRule,
} from "../audit-report-types.js";
import { describeScope, findingViolation } from "../audit-report-wording.js";
import {
  EVIDENCE_PATH,
  evidenceExpiry,
  isEvidenceFresh,
  type EvidenceRecordRef,
} from "../evidence.js";
import { EVIDENCE_RUNGS, rungAtLeast } from "../evidence-types.js";
import { PROOF_HALVES } from "../proof-halves.js";
import { minimumRungOf } from "../verdict.js";
import { rungInWords } from "../verdict-wording.js";

/** The name this rule's violations carry. */
export const PROVED_EVIDENCE_RULE = "proved-evidence";

/** The state whose findings cite a record. */
const PROVED = "proved";

/** The rung of a record that is one half of a paired proof. */
const EXERCISED = "exercised";

const OR_CHOOSE = "or choose another state";

/** What each half of a paired proof is, in words. */
const HALF_IN_WORDS: Readonly<Record<string, string>> = {
  violation: "the change that breaks the rule and has to be refused",
  clean: "the change that keeps the rule and has to be accepted",
};

/**
 * Say why a record is too weakly known to prove a finding's requirement.
 *
 * A finding whose requirement the catalogue does not hold is refused by
 * another rule. Here it is held to the strongest rung, like a requirement
 * that names none: nothing is made easier to prove by being unknown.
 * @param record - The cited record, already fresh and for the right place
 * @param finding - The finding that cites it
 * @param context - The facts it is checked against
 * @returns The reason, or `null` when the record's rung reaches the weakest
 *   one the requirement accepts
 */
function tooWeak(
  record: EvidenceRecordRef,
  finding: AuditFinding,
  context: AuditReportContext
): string | null {
  const requirement = context.criteria.find(
    criterion => criterion.id === finding.criterion
  );
  const minimum =
    requirement === undefined ? EXERCISED : minimumRungOf(requirement);
  const rung = EVIDENCE_RUNGS.find(each => each === record.rung);
  if (rung === undefined) {
    return `Evidence record "${record.id}" does not say how strongly it is known, so it cannot prove anything. Run the attest step again, ${OR_CHOOSE}.`;
  }
  return rungAtLeast(rung, minimum)
    ? null
    : `Evidence record "${record.id}" is ${rungInWords(rung)}. This requirement is proved only by evidence that is ${rungInWords(minimum)}. Cite a record of that strength for this requirement, ${OR_CHOOSE}.`;
}

/**
 * Say why a record is not a whole proof, when it is one half of a pair.
 * @param record - The cited record, already fresh and for the right place
 * @param context - The facts it is checked against
 * @returns The reason, or `null` when the record stands on its own or its
 *   other half is on record and current
 */
function unpaired(
  record: EvidenceRecordRef,
  context: AuditReportContext
): string | null {
  if (record.half === null && record.rung !== EXERCISED) return null;
  const other = PROOF_HALVES.find(half => half !== record.half);
  const known = PROOF_HALVES.some(half => half === record.half);
  if (!known || other === undefined || record.entry_id === null) {
    return `Evidence record "${record.id}" does not say which half of which control's proof it is, so it cannot prove anything. Run the attest step again, ${OR_CHOOSE}.`;
  }
  const paired = context.evidence.some(
    candidate =>
      candidate.half === other &&
      candidate.entry_id === record.entry_id &&
      candidate.criterion === record.criterion &&
      candidate.scope === record.scope &&
      candidate.moment === record.moment &&
      isEvidenceFresh(candidate, context.now)
  );
  return paired
    ? null
    : `Evidence record "${record.id}" is one half of a proof, and the other half (${HALF_IN_WORDS[other] ?? other}) is not on record as held and current. A control is proved only by both halves. Run the attest step again, ${OR_CHOOSE}.`;
}

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
  if (record.scope !== finding.scope && record.scope !== REPOSITORY_SCOPE) {
    const about =
      record.scope === null
        ? "does not say which part of the repository it is about"
        : `is about the ${describeScope(record.scope)}`;
    return `Evidence record "${id}" ${about}, so it cannot prove the requirement for the ${describeScope(finding.scope)}. Cite a record for this part, ${OR_CHOOSE}.`;
  }
  if (!isEvidenceFresh(record, context.now)) {
    return Date.parse(record.completed_at) > context.now.getTime()
      ? `Evidence record "${id}" is dated later than the current time, so it cannot be relied on. Run the attest step again, ${OR_CHOOSE}.`
      : `Evidence record "${id}" is too old to rely on: it stopped being current at ${evidenceExpiry(record).toISOString()}. Run the attest step again, ${OR_CHOOSE}.`;
  }
  return tooWeak(record, finding, context) ?? unpaired(record, context);
}

/**
 * Say what is wrong with what a finding cites.
 * @param finding - Any finding
 * @param context - The facts it is checked against
 * @returns The reason, or `null` when a `proved` finding is backed and any
 *   other finding cites nothing
 */
function miscited(
  finding: AuditFinding,
  context: AuditReportContext
): string | null {
  if (finding.state === PROVED) return unbacked(finding, context);
  return finding.evidence_id === undefined
    ? null
    : `This finding cites evidence record "${finding.evidence_id}" but does not say the requirement is proved. Only a proved finding cites a record: remove "evidence_id" from this one.`;
}

/**
 * Every `proved` finding cites fresh evidence of its own requirement and
 * folder, as strong as the requirement asks for, both halves when it is a
 * paired proof, and no other finding cites a record.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const provedNeedsFreshEvidence: AuditReportRule = (report, context) =>
  report.findings.flatMap(finding => {
    const reason = miscited(finding, context);
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
