/**
 * Rule: every finding says what was found, why it matters and what to do
 * next, in plain language.
 *
 * The report is read by an operator who may never have opened the
 * specification. A criterion id in a sentence is a reference they cannot
 * follow, and an empty field is a question left unanswered, so neither is
 * accepted. The id has its own field, `criterion`, and stays there.
 * @module controls/audit-report-rules/plain-language
 */
import {
  PLAIN_LANGUAGE_FIELDS,
  type AuditFinding,
  type AuditReportRule,
  type AuditReportViolation,
  type PlainLanguageField,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";
import { criterionIdsIn } from "../catalogue.js";

/** The name this rule's violations carry. */
export const PLAIN_LANGUAGE_RULE = "plain-language";

/** What each field is for, said as an instruction. */
const ASK: Readonly<Record<PlainLanguageField, string>> = {
  what: "Say in plain words what was found.",
  why: "Say in plain words why it matters.",
  next: "Say in plain words what to do next.",
};

/**
 * Check one plain-language field of one finding.
 * @param finding - The finding
 * @param field - Which of its three fields
 * @returns The violation, or nothing when the field is sound
 */
function fieldViolations(
  finding: AuditFinding,
  field: PlainLanguageField
): readonly AuditReportViolation[] {
  const text = finding[field];
  if (text.trim() === "") {
    return [
      findingViolation(
        PLAIN_LANGUAGE_RULE,
        finding,
        `The "${field}" field is empty. ${ASK[field]}`,
        field
      ),
    ];
  }
  return criterionIdsIn(text).length === 0
    ? []
    : [
        findingViolation(
          PLAIN_LANGUAGE_RULE,
          finding,
          `The "${field}" field names a requirement by its id. ${ASK[field]} The id belongs in the "criterion" field only.`,
          field
        ),
      ];
}

/**
 * None of the three plain-language fields is empty or contains a criterion id.
 * @param report - The report
 * @returns The violations found
 */
export const plainLanguageFields: AuditReportRule = report =>
  report.findings.flatMap(finding =>
    PLAIN_LANGUAGE_FIELDS.flatMap(field => fieldViolations(finding, field))
  );
