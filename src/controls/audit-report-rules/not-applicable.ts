/**
 * Rule: a requirement that always applies is never filed as not applicable.
 *
 * The catalogue gives every in-scope requirement the one condition under
 * which it does not apply. For many of them that condition is `never`:
 * nothing about a repository makes the requirement go away. A finding that
 * files such a requirement as `not-applicable` is refused here, because the
 * verdict counts a requirement that does not apply as one with nothing left
 * to show, and a report could otherwise reach a clean result by saying that
 * nothing applies.
 *
 * ## What this rule does not check
 *
 * For a requirement whose condition is anything else, whether the condition
 * holds in this repository is the audit's judgement, and code cannot check
 * it. The finding has to give the fact in `what` (the plain-language rule
 * requires the field), and `lisa controls report-check` prints how many
 * findings were filed this way, so the number is in front of whoever reads
 * the result.
 * @module controls/audit-report-rules/not-applicable
 */
import {
  NOT_APPLICABLE_STATE,
  type AuditReportRule,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";
import { NEVER_NOT_APPLICABLE } from "../catalogue.js";

/** The name this rule's violations carry. */
const NOT_APPLICABLE_RULE = "not-applicable";

/** What a finding about a requirement that always applies is told. */
const ALWAYS_APPLIES = `This finding says the requirement does not apply here, but this requirement always applies: nothing about a repository makes it not apply. Say what was found instead: "missing" when nothing does it, "exists-not-enforced" when something does, "unknown" or "question" when that cannot be told.`;

/**
 * No finding files a requirement that always applies as not applicable.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const notApplicableOnlyWhereItMayBe: AuditReportRule = (
  report,
  context
) => {
  const always = new Set(
    context.criteria
      .filter(
        criterion => criterion.not_applicable_when === NEVER_NOT_APPLICABLE
      )
      .map(criterion => criterion.id)
  );
  return report.findings
    .filter(
      finding =>
        finding.state === NOT_APPLICABLE_STATE && always.has(finding.criterion)
    )
    .map(finding =>
      findingViolation(NOT_APPLICABLE_RULE, finding, ALWAYS_APPLIES, "state")
    );
};
