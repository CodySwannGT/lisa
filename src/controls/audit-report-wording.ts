/**
 * How the audit report code speaks to an operator.
 *
 * Everything the report check prints is read by someone who may not know the
 * specification. A sentence says what is wrong and what to do; the criterion
 * id and the folder follow it in brackets, as the place to look and never as
 * the explanation.
 * @module controls/audit-report-wording
 */
import {
  REPOSITORY_SCOPE,
  type AuditFinding,
  type AuditReportViolation,
} from "./audit-report-types.js";

/**
 * Name a scope the way an operator would.
 * @param scope - A report scope
 * @returns `whole repository`, or the folder
 */
export function describeScope(scope: string): string {
  return scope === REPOSITORY_SCOPE ? "whole repository" : `folder ${scope}`;
}

/**
 * Build a violation about one finding.
 * @param rule - The rule that was broken
 * @param finding - The finding it is about
 * @param message - What is wrong and what to do, with no criterion id in it
 * @param field - The finding field it is about, when it is about one
 * @returns The violation
 */
export function findingViolation(
  rule: string,
  finding: AuditFinding,
  message: string,
  field?: string
): AuditReportViolation {
  return {
    rule,
    message,
    criterion: finding.criterion,
    scope: finding.scope,
    ...(field === undefined ? {} : { field }),
  };
}

/**
 * Render a violation as the one line the report check prints.
 * @param violation - The violation
 * @returns The sentence, then where to look in brackets
 */
export function formatAuditReportViolation(
  violation: AuditReportViolation
): string {
  const place = [
    ...(violation.criterion === undefined
      ? []
      : [`requirement ${violation.criterion}`]),
    ...(violation.scope === undefined ? [] : [describeScope(violation.scope)]),
  ];
  const line =
    place.length === 0
      ? violation.message
      : `${violation.message} (${place.join(", ")})`;
  return line.replaceAll(/\s+/gu, " ").trim();
}
