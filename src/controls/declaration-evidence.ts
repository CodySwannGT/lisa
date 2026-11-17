/**
 * Holding what a gates declaration says supports each part to what the audit
 * report actually holds.
 *
 * The control register refuses a part that names nothing. That is as far as
 * it can go, because it never reads the audit report: the register must be
 * the same bytes wherever it is generated, and the report is not everywhere.
 * This module is the other half, used where the report is in reach. It checks
 * that what a part names is really there:
 *
 * - a place (`evidence.locators`) is one the audit reported, on a finding
 *   that says a check exists, for a requirement the entry serves, about the
 *   entry's folder, a folder inside it, or the whole repository;
 * - a question (`evidence.questions`) is one a person has answered, about a
 *   requirement the entry serves, in a part of the repository that bears on
 *   the entry in the same way;
 * - no requirement the entry serves is still an open question there, because
 *   an unanswered question produces no entry.
 *
 * Nothing here depends on how many findings a requirement has or on where
 * the catalogue says it is answered: the report is read as it was validated,
 * finding by finding.
 *
 * ## Exactly which entries it applies to
 *
 * The register entries that carry `evidence`, which are the ones generated
 * from a gate's `parts`. An entry of a gate with no parts comes from the
 * declarations Lisa ships for a supported project type and is not looked at.
 *
 * ## How an answered question is recognised
 *
 * The audit never lets an agent name a question. A question about a
 * requirement has the id `<requirement>@<scope>` (`./question-ids.ts`), and
 * once a person answers it the question leaves the report's `questions` and
 * its answer is recorded in `answers` under the same id
 * (`./audit-answers.ts`). So an id tells this check three things without
 * reading the answer's words: whether an answer is on record, which
 * requirement it is about, and which part of the repository. A question
 * about how the repository is set up (which tracker, which platform) is
 * about no requirement and supports no part.
 *
 * A finding in the state `question` is still open: the report check refuses
 * a finding that stays in that state once its question has an answer.
 * @module controls/declaration-evidence
 */
import { recordedAnswer } from "./audit-answers.js";
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  LOCATED_STATES,
  describeScope,
  type AuditFinding,
  type AuditReport,
} from "./audit-report.js";
import type { InScopeCriterion } from "./catalogue.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { parseQuestionId } from "./question-ids.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegister,
  type ControlRegisterEntry,
  type EvidenceLocator,
} from "./register-types.js";

/** The finding state of a requirement only a person can answer. */
const OPEN_QUESTION = "question";

/** What a declaration's evidence is held to. */
export interface DeclarationEvidenceFacts {
  /** The register the declaration generates. */
  readonly register: ControlRegister;
  /** The validated audit report. */
  readonly report: AuditReport;
  /** The in-scope criteria, for a requirement's plain question. */
  readonly criteria: readonly InScopeCriterion[];
}

/**
 * The entries a declaration's evidence check applies to.
 * @param register - The register the declaration generates
 * @returns The entries generated from a part, each of which carries evidence
 */
export function evidencedEntries(
  register: ControlRegister
): readonly ControlRegisterEntry[] {
  return register.entries.filter(entry => entry.evidence !== undefined);
}

/**
 * Tell whether something the audit recorded about a part of the repository
 * bears on an entry.
 *
 * It does when it is about the entry's folder or a folder inside it. It also
 * does when it is about the whole repository, whatever folder the entry
 * covers: a requirement that has one answer for the repository has its only
 * finding there, and that finding lists what was found in every folder. So a
 * check found for one folder under such a requirement supports a part for
 * that folder, and a question still open about such a requirement stops a
 * part in any folder. What never bears on an entry is something recorded
 * about a different folder.
 * @param entryScope - The folder the entry covers
 * @param recordedScope - The folder the finding or the question is about
 * @returns Whether the entry is held to it
 */
function covers(entryScope: string, recordedScope: string): boolean {
  return (
    entryScope === WHOLE_REPOSITORY_SCOPE ||
    recordedScope === WHOLE_REPOSITORY_SCOPE ||
    recordedScope === entryScope ||
    recordedScope.startsWith(`${entryScope}/`)
  );
}

/**
 * Name an entry the way the declaration writes it.
 * @param entry - The entry
 * @returns For example `The gate "code-style" in .lisa.config.json has a part
 *   for the folder api`
 */
function partOf(entry: ControlRegisterEntry): string {
  return `The gate "${entry.gate}" in ${GATES_DECLARATION_PATH} has a part for the ${describeScope(entry.scope)}`;
}

/**
 * Tell whether a finding says a check exists at a place.
 * @param finding - The finding
 * @param locator - The place
 * @returns Whether one of the finding's mechanisms was found there
 */
function foundAt(finding: AuditFinding, locator: EvidenceLocator): boolean {
  return (
    LOCATED_STATES.includes(finding.state) &&
    finding.mechanisms.some(mechanism =>
      mechanism.locators.some(
        found => found.path === locator.path && found.line === locator.line
      )
    )
  );
}

/**
 * Check the places one entry names.
 * @param entry - An entry that carries evidence
 * @param covered - The findings for the entry's requirements in its folder
 * @returns One line per place the audit report does not support
 */
function locatorProblems(
  entry: ControlRegisterEntry,
  covered: readonly AuditFinding[]
): readonly string[] {
  const locators = entry.evidence?.locators ?? [];
  if (locators.length > 0 && entry.criteria.length === 0) {
    return [
      `${partOf(entry)} that names a place the audit found its check, but the gate serves no requirement, so no finding of the audit can support it. List the requirements it serves in the gate's "criteria", or remove the part.`,
    ];
  }
  return locators
    .filter(locator => !covered.some(finding => foundAt(finding, locator)))
    .map(
      locator =>
        `${partOf(entry)} that says its check was found at ${locator.path} line ${locator.line}, but ${AUDIT_REPORT_JSON_PATH} reports no check there for a requirement this gate serves in that part of the repository. Copy the place exactly from a finding that says a check exists, or remove the part.`
    );
}

/**
 * Say why one question a part names does not support it, when it does not.
 * @param entry - An entry that carries evidence
 * @param id - The question id the part names
 * @param report - The validated audit report
 * @returns The rest of the sentence after the question is named, or `null`
 *   when an answer to it is on record and it is about this entry
 */
function questionProblem(
  entry: ControlRegisterEntry,
  id: string,
  report: AuditReport
): string | null {
  if (report.questions.some(question => question.id === id)) {
    return `that question is still waiting for its answer in ${AUDIT_REPORT_MARKDOWN_PATH}. A rule is recorded only once its question is answered. Have it answered and run the audit again, or remove the part.`;
  }
  if (recordedAnswer(report, id) === null) {
    return `${AUDIT_REPORT_JSON_PATH} holds no answer to a question with that id. A rule is recorded only once its question is answered. Copy the id from an answer the report records, or remove the part.`;
  }
  const asked = parseQuestionId(id);
  if (asked === null || asked.kind === "setup") {
    return `that question is about how the repository is set up, not about a requirement. A part rests on the answer to a question about a requirement its gate serves. Name that question, or remove the part.`;
  }
  return entry.criteria.includes(asked.criterion) &&
    covers(entry.scope, asked.scope)
    ? null
    : `that question is about another requirement or another part of the repository than this part. A part rests on the answer to a question about a requirement its gate serves, there. Name that question, or remove the part.`;
}

/**
 * Check the questions one entry names.
 * @param entry - An entry that carries evidence
 * @param report - The validated audit report
 * @returns One line per question that does not support the entry
 */
function questionProblems(
  entry: ControlRegisterEntry,
  report: AuditReport
): readonly string[] {
  return (entry.evidence?.questions ?? []).flatMap(id => {
    const problem = questionProblem(entry, id, report);
    return problem === null
      ? []
      : [
          `${partOf(entry)} that rests on the audit question "${id}", but ${problem}`,
        ];
  });
}

/**
 * Report the requirements of one entry that are still open questions.
 * @param entry - An entry that carries evidence
 * @param covered - The findings for the entry's requirements in its folder
 * @param criteria - The in-scope criteria
 * @returns One line per requirement the audit still asks about
 */
function openQuestionProblems(
  entry: ControlRegisterEntry,
  covered: readonly AuditFinding[],
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  return covered
    .filter(finding => finding.state === OPEN_QUESTION)
    .map(finding => {
      const asked =
        criteria.find(criterion => criterion.id === finding.criterion)
          ?.question ?? finding.what;
      return `${partOf(entry)}, but the audit still has an open question for the ${describeScope(finding.scope)}: "${asked}" Nothing is recorded for a requirement until its question is answered. Remove the part, or take that requirement off the gate's "criteria", until the audit has the answer.`;
    });
}

/**
 * Hold a declaration's evidence to the audit report.
 * @param facts - The generated register and the validated report
 * @returns One line per problem, each naming the gate and the part; empty
 *   when every part is supported by what the report holds
 */
export function declarationEvidenceProblems(
  facts: DeclarationEvidenceFacts
): readonly string[] {
  const { register, report, criteria } = facts;
  return evidencedEntries(register).flatMap(entry => {
    const covered = report.findings.filter(
      finding =>
        entry.criteria.includes(finding.criterion) &&
        covers(entry.scope, finding.scope)
    );
    return [
      ...locatorProblems(entry, covered),
      ...questionProblems(entry, report),
      ...openQuestionProblems(entry, covered, criteria),
    ];
  });
}
