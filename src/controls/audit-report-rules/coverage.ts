/**
 * Rule: every in-scope criterion is placed exactly once in every part.
 *
 * A report that skips a requirement, or places it in two states, cannot be
 * counted: the number of classified criteria has to equal the number of
 * in-scope catalogue entries for each part the report covers. A finding for an
 * id the catalogue does not hold at this level, or for a part the report does
 * not list, belongs to no count at all and is refused too.
 * @module controls/audit-report-rules/coverage
 */
import type {
  AuditFinding,
  AuditReportRule,
  AuditReportViolation,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";

/** The name this rule's violations carry. */
export const COVERAGE_RULE = "coverage";

/**
 * Report what is wrong with how one part's findings cover the catalogue.
 * @param scope - The part
 * @param findings - The findings filed under it
 * @param criteria - Ids of the in-scope criteria, in catalogue order
 * @returns One violation for an empty part, otherwise one per criterion that
 *   is absent or placed more than once
 */
function partViolations(
  scope: string,
  findings: readonly AuditFinding[],
  criteria: readonly string[]
): readonly AuditReportViolation[] {
  if (findings.length === 0) {
    return [
      {
        rule: COVERAGE_RULE,
        scope,
        message: `The report lists this part but has no findings for it. Add one finding for every requirement, or take the part off the "scopes" list.`,
      },
    ];
  }
  return criteria.flatMap(criterion => {
    const placed = findings.filter(
      finding => finding.criterion === criterion
    ).length;
    if (placed === 1) return [];
    return [
      {
        rule: COVERAGE_RULE,
        criterion,
        scope,
        message:
          placed === 0
            ? "No finding places this requirement. Add exactly one."
            : `${placed} findings place this requirement, so it is in more than one state. Keep exactly one.`,
      },
    ];
  });
}

/**
 * Every in-scope criterion appears exactly once per scope, and nothing else
 * appears at all.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const everyCriterionOncePerScope: AuditReportRule = (
  report,
  context
) => {
  const criteria = context.criteria.map(criterion => criterion.id);
  const scopes = [...new Set(report.scopes)];
  const unknown = report.findings.filter(
    finding => !criteria.includes(finding.criterion)
  );
  const unlisted = report.findings.filter(
    finding =>
      criteria.includes(finding.criterion) && !scopes.includes(finding.scope)
  );
  return [
    ...unknown.map(finding =>
      findingViolation(
        COVERAGE_RULE,
        finding,
        "This finding is filed under an id that is not a Level 1 requirement in the catalogue. Correct the id, or remove the finding.",
        "criterion"
      )
    ),
    ...unlisted.map(finding =>
      findingViolation(
        COVERAGE_RULE,
        finding,
        `This finding is filed under a part the report's "scopes" list does not include. Add the part to the list, or move the finding.`,
        "scope"
      )
    ),
    ...scopes.flatMap(scope =>
      partViolations(
        scope,
        report.findings.filter(finding => finding.scope === scope),
        criteria
      )
    ),
  ];
};
