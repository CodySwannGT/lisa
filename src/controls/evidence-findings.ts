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
 * What a finding is worth depends on what kind of thing answers the
 * requirement, which the catalogue says.
 *
 * ## A requirement answered by a record that exists (`artifact`)
 *
 * The audit says where the record is: a file and a line. The attest step
 * does not take that on trust, and does not rely on the report's own check
 * having run: it opens each file the finding points at and looks for the
 * line. When every pointer leads to a line that is there, the finding is
 * written at the `observed` rung and `held`. When the finding points
 * nowhere, or a pointer no longer leads to a line, it is written `unknown`
 * and says the record could not be found where the audit pointed.
 *
 * What `observed` means here, and what it does not: code saw that the file
 * and line exist. That the file is the record the requirement asks for is
 * the audit's judgement. It is a located file, not a proof.
 *
 * ## A requirement a person vouches for (`human-attested`)
 *
 * Only a person's answer meets it. The finding is written `held`, at the
 * `asserted` rung, when the audit found it written down *and* the report
 * holds a person's answer to the question for that requirement and folder.
 * The record quotes the question's id and the answer, which is the
 * attestation. With no answer on record it is written `unknown`: an agent
 * finding a document never stands in for a person saying so.
 *
 * ## A requirement answered by a check (`gate`)
 *
 * A finding is written at the `asserted` rung and can never make the
 * requirement conforming. Only a control in the register can.
 *
 * ## Every other state, for every kind
 *
 * | finding | record's `result` |
 * | --- | --- |
 * | `missing` | `failed`: the audit found nothing that does it |
 * | `unknown`, `question` | `unknown` |
 * | `not-applicable` | `not-applicable`, with the finding's `what` as the fact |
 * | `proved` | no record: the finding only repeats a record already here |
 * @module controls/evidence-findings
 */
import { recordedAnswer } from "./audit-answers.js";
import type {
  AuditFinding,
  AuditFindingState,
  AuditLocator,
  AuditReport,
} from "./audit-report-types.js";
import type { InScopeCriterion } from "./catalogue.js";
import {
  ARTIFACT_KIND,
  FINDING_REASONS,
  findingRecordId,
  HUMAN_ATTESTED_KIND,
  type EvidenceRecord,
  type EvidenceResult,
  type EvidenceRung,
} from "./evidence-types.js";
import type { EvidenceStamp } from "./evidence-write.js";
import { requirementQuestionId } from "./question-ids.js";
import type { RepositoryReader } from "./repository-reader.js";

/** The state of a finding that says something answering the requirement is there. */
const FOUND_STATE: AuditFindingState = "exists-not-enforced";

/** How many pointers a record's sentence names before it counts the rest. */
const NAMED_LOCATORS = 5;

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

/** What the attest step needs to write a report's findings down. */
export interface FindingsToRecord {
  /** A report that passed every check. */
  readonly report: Pick<AuditReport, "findings" | "answers">;
  /** The in-scope requirements, which say what kind of thing answers each. */
  readonly criteria: readonly InScopeCriterion[];
  /** Reads the repository the report points into. */
  readonly repository: RepositoryReader;
  /** The commit and the freshness lifetime of the run. */
  readonly stamp: EvidenceStamp;
  /** When the attest step read the report. */
  readonly readAt: Date;
}

/** What one finding is written down as. */
type Judged = Pick<EvidenceRecord, "rung" | "result" | "reason" | "detail">;

/**
 * Write a pointer the way a person would.
 * @param locator - The pointer
 * @returns For example `docs/access.md line 12`
 */
function pointer(locator: AuditLocator): string {
  return `${locator.path} line ${locator.line}`;
}

/**
 * Name a few pointers and count the rest.
 * @param locators - The pointers
 * @returns For example `README.md line 3, docs/access.md line 12`
 */
function pointers(locators: readonly AuditLocator[]): string {
  const named = locators.slice(0, NAMED_LOCATORS).map(pointer).join(", ");
  const rest = locators.length - NAMED_LOCATORS;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * Tell whether a pointer leads to a line that is in the repository now.
 * @param locator - The pointer
 * @param repository - Reads the repository
 * @returns Whether the line is there
 */
function resolves(
  locator: AuditLocator,
  repository: RepositoryReader
): boolean {
  const lines = repository.lineCount(locator.path);
  return (
    lines !== null &&
    Number.isInteger(locator.line) &&
    locator.line >= 1 &&
    locator.line <= lines
  );
}

/**
 * What a finding that says a record exists is written down as.
 * @param finding - The finding, in the state that says something is there
 * @param repository - Reads the repository
 * @returns The record's rung, result, reason and sentence
 */
function artifact(finding: AuditFinding, repository: RepositoryReader): Judged {
  const locators = finding.mechanisms.flatMap(mechanism => mechanism.locators);
  const gone = locators.filter(locator => !resolves(locator, repository));
  if (locators.length > 0 && gone.length === 0) {
    return {
      rung: "observed",
      result: "held",
      reason: FINDING_REASONS.located,
      detail: `${finding.what} The attest step found every line the audit pointed at: ${pointers(locators)}.`,
    };
  }
  const why =
    locators.length === 0
      ? "the audit pointed at no file and line"
      : `nothing is at ${pointers(gone)}`;
  return {
    rung: "asserted",
    result: "unknown",
    reason: FINDING_REASONS.notFound,
    detail: `The audit said this is recorded, but the attest step could not find the record where the audit pointed: ${why}. Run the audit again so that it points at a file and line that exist.`,
  };
}

/**
 * What a finding about something a person vouches for is written down as.
 * @param finding - The finding, in the state that says something is there
 * @param report - The report, which holds the answers people gave
 * @returns The record's rung, result, reason and sentence
 */
function attestation(
  finding: AuditFinding,
  report: Pick<AuditReport, "answers">
): Judged {
  const id = requirementQuestionId(finding.criterion, finding.scope);
  const answer = recordedAnswer(report, id);
  return answer === null
    ? {
        rung: "asserted",
        result: "unknown",
        reason: FINDING_REASONS.noAttestation,
        detail: `Only a person can vouch for this requirement, and no person's answer to the audit's question "${id}" is on record. The audit has to ask that question, and a person has to answer it in the audit report.`,
      }
    : {
        rung: "asserted",
        result: "held",
        reason: FINDING_REASONS.attested,
        detail: `A person answered the audit's question "${id}" (${answer.question}): "${answer.answer}". ${finding.what}`,
      };
}

/**
 * What one finding is written down as.
 * @param finding - The finding
 * @param kind - What kind of thing answers its requirement
 * @param request - The report and the repository reader
 * @returns The record's rung, result, reason and sentence, or `null` when
 *   the finding gets no record
 */
function judged(
  finding: AuditFinding,
  kind: unknown,
  request: FindingsToRecord
): Judged | null {
  const result = FINDING_RESULTS[finding.state];
  if (result === null) return null;
  if (finding.state === FOUND_STATE && kind === ARTIFACT_KIND) {
    return artifact(finding, request.repository);
  }
  if (finding.state === FOUND_STATE && kind === HUMAN_ATTESTED_KIND) {
    return attestation(finding, request.report);
  }
  const rung: EvidenceRung = "asserted";
  return { rung, result, reason: finding.state, detail: finding.what };
}

/**
 * The evidence records for the findings of an audit report.
 * @param request - The report, the requirements, the repository and the run
 * @returns One record per finding that says something of its own
 */
export function findingRecords(
  request: FindingsToRecord
): readonly EvidenceRecord[] {
  const { stamp } = request;
  const at = request.readAt.toISOString();
  return request.report.findings.flatMap(
    (finding): readonly EvidenceRecord[] => {
      const written = judged(
        finding,
        request.criteria.find(criterion => criterion.id === finding.criterion)
          ?.kind,
        request
      );
      return written === null
        ? []
        : [
            {
              id: findingRecordId(finding.criterion, finding.scope),
              criterion: finding.criterion,
              entry_id: null,
              scope: finding.scope,
              ...written,
              moment: null,
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
    }
  );
}
