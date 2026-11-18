/**
 * Rule: a claim that a control exists points at a line that is really there.
 *
 * The audit records, for each mechanism it finds, a file path and line number
 * that evidences it. A finding that says a control is in place (`proved` or
 * `exists-not-enforced`) must carry at least one such pointer, and every
 * pointer in the report, whatever the finding's state, must lead to an
 * existing line: a pointer that leads nowhere is a claim nobody can check.
 *
 * A pointer must also lead to something the repository itself holds. The
 * audit's own report, the records Lisa's commands write and git's own data
 * exist whatever the repository does, so a line in one of them shows nothing
 * about a control, and the attest step would otherwise record a requirement
 * as met on the strength of it. Which places those are, and the two
 * exceptions, is decided in `../repository-reader.ts`.
 * @module controls/audit-report-rules/locators
 */
import {
  LOCATED_STATES,
  type AuditLocator,
  type AuditReportRule,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";
import {
  recordKeepingPlace,
  type RepositoryReader,
} from "../repository-reader.js";

/** The name this rule's violations carry. */
export const LOCATORS_RULE = "locators";

/**
 * Say why a pointer leads nowhere.
 * @param locator - The pointer
 * @param repository - The repository it points into
 * @returns The reason, or `null` when the line exists
 */
function dangling(
  locator: AuditLocator,
  repository: RepositoryReader
): string | null {
  const place = recordKeepingPlace(locator.path);
  if (place !== null) {
    return `The pointer ${locator.path} line ${locator.line} leads into ${place}. A file there cannot show that a control is in place. Point at the file of the repository that does, or choose another state.`;
  }
  const pointer = `The pointer ${locator.path} line ${locator.line} leads nowhere`;
  const lines = repository.lineCount(locator.path);
  if (lines === null) {
    return `${pointer}: no such file is in the repository. Point at a file and line that exist.`;
  }
  return locator.line <= lines
    ? null
    : `${pointer}: that file has ${lines} ${lines === 1 ? "line" : "lines"}. Point at a line that exists.`;
}

/**
 * Every pointer resolves, and every claim that a control exists has one.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const locatorsResolve: AuditReportRule = (report, context) =>
  report.findings.flatMap(finding => {
    const locators = finding.mechanisms.flatMap(
      mechanism => mechanism.locators
    );
    const unlocated =
      locators.length === 0 && LOCATED_STATES.includes(finding.state)
        ? [
            `This finding says a control is in place but points at no file and line that shows it. Add at least one pointer under "mechanisms", or choose another state.`,
          ]
        : [];
    const reasons = locators.flatMap(locator => {
      const reason = dangling(locator, context.repository);
      return reason === null ? [] : [reason];
    });
    return [...unlocated, ...reasons].map(reason =>
      findingViolation(LOCATORS_RULE, finding, reason, "mechanisms")
    );
  });
