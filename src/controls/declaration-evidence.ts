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
 * - a question (`evidence.questions`) is one the report holds an answer to;
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
 * ## The question form is built against a stated shape
 *
 * The audit report does not hold questions yet. The shape this reads is the
 * one agreed for them: a top-level `questions` list whose items have an `id`
 * and, once a person has answered, a non-blank `answer`. A report without
 * that list has no answered question. A finding in state `question` is taken
 * to be still open: once a question is answered, the audit re-runs and places
 * the requirement in another state.
 * @module controls/declaration-evidence
 */
import { isJsonObject } from "../sync/json-path.js";
import {
  AUDIT_REPORT_JSON_PATH,
  LOCATED_STATES,
  describeScope,
  type AuditFinding,
  type AuditReport,
} from "./audit-report.js";
import type { InScopeCriterion } from "./catalogue.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
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
  /** The report exactly as parsed, for its questions. */
  readonly document: unknown;
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
 * The ids of the audit questions a person has answered.
 * @param document - The parsed content of the audit report, of any shape
 * @returns Each id whose question carries a non-blank answer
 */
export function answeredQuestionIds(document: unknown): readonly string[] {
  if (!isJsonObject(document) || !Array.isArray(document.questions)) return [];
  return document.questions.flatMap(question =>
    isJsonObject(question) &&
    typeof question.id === "string" &&
    typeof question.answer === "string" &&
    question.answer.trim() !== ""
      ? [question.id]
      : []
  );
}

/**
 * Tell whether a finding bears on an entry.
 *
 * It does when it is about the entry's folder or a folder inside it. It also
 * does when it is about the whole repository, whatever folder the entry
 * covers: a requirement that has one answer for the repository has its only
 * finding there, and that finding lists what was found in every folder. So a
 * check found for one folder under such a requirement supports a part for
 * that folder, and a question still open about such a requirement stops a
 * part in any folder. What never bears on an entry is a finding about a
 * different folder.
 * @param entryScope - The folder the entry covers
 * @param findingScope - The folder the finding is about
 * @returns Whether the finding is one the entry is held to
 */
function covers(entryScope: string, findingScope: string): boolean {
  return (
    entryScope === WHOLE_REPOSITORY_SCOPE ||
    findingScope === WHOLE_REPOSITORY_SCOPE ||
    findingScope === entryScope ||
    findingScope.startsWith(`${entryScope}/`)
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
 * Check the questions one entry names.
 * @param entry - An entry that carries evidence
 * @param answered - The ids of the answered questions
 * @returns One line per question the report holds no answer to
 */
function questionProblems(
  entry: ControlRegisterEntry,
  answered: readonly string[]
): readonly string[] {
  return (entry.evidence?.questions ?? [])
    .filter(id => !answered.includes(id))
    .map(
      id =>
        `${partOf(entry)} that rests on the audit question "${id}", but ${AUDIT_REPORT_JSON_PATH} holds no answer to a question with that id. A rule is recorded only once its question is answered. Have the question answered and run the audit again, or remove the part.`
    );
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
  const { register, report, criteria, document } = facts;
  const answered = answeredQuestionIds(document);
  return evidencedEntries(register).flatMap(entry => {
    const covered = report.findings.filter(
      finding =>
        entry.criteria.includes(finding.criterion) &&
        covers(entry.scope, finding.scope)
    );
    return [
      ...locatorProblems(entry, covered),
      ...questionProblems(entry, answered),
      ...openQuestionProblems(entry, covered, criteria),
    ];
  });
}
