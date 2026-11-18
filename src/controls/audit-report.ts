/**
 * The audit report: what it is, and what makes one valid.
 *
 * The audit is written by an agent, so its output is checked by code before
 * anyone relies on it. A report is the parsed content of
 * `.lisa/audit/report.json`; {@link validateAuditReport} checks its shape and
 * then runs every rule on {@link AUDIT_REPORT_RULES} against it.
 *
 * ## Adding a rule
 *
 * A rule is one function of the report and the facts it is checked against,
 * returning the violations it finds. Rules do not call each other and do not
 * depend on order. To add one, write it in its own module under
 * `./audit-report-rules/` and add it to the list below: one import and one
 * entry. Violations print in list order, then in the order the rule returns
 * them.
 *
 * A rule that needs a fact the context does not carry adds a field to
 * `AuditReportContext` and has the command fill it in; a rule about a new
 * report section adds the section first (see `./audit-report-shape.ts`).
 * @module controls/audit-report
 */
import { everyCriterionOncePerScope } from "./audit-report-rules/coverage.js";
import { locatorsResolve } from "./audit-report-rules/locators.js";
import { notApplicableOnlyWhereItMayBe } from "./audit-report-rules/not-applicable.js";
import { plainLanguageFields } from "./audit-report-rules/plain-language.js";
import { dependentsOfUnreadSystemsAreUnknown } from "./audit-report-rules/probe-dependents.js";
import { probesHoldNoCredentials } from "./audit-report-rules/probe-secrets.js";
import { probesAreWellFormed } from "./audit-report-rules/probes.js";
import { provedNeedsFreshEvidence } from "./audit-report-rules/proved-evidence.js";
import { questionsMatchFindings } from "./audit-report-rules/questions.js";
import { answersAreWhatWasTyped } from "./audit-report-rules/recorded-answers.js";
import { scopesAreRepositoryFolders } from "./audit-report-rules/scopes.js";
import { reportHoldsNoSecretValues } from "./audit-report-rules/secret-values.js";
import { serverSideAuthorityNeedsPlatformRead } from "./audit-report-rules/server-side-authority.js";
import { trackerQuestionAsked } from "./audit-report-rules/tracker-question.js";
import {
  parseAuditReport,
  type ParsedAuditReport,
} from "./audit-report-shape.js";
import type {
  AuditReportContext,
  AuditReportRule,
} from "./audit-report-types.js";

export * from "./audit-probe-types.js";
export {
  isNeededBy,
  isReached,
  probeOf,
  unreachedProbesOf,
} from "./audit-probes.js";
export * from "./audit-report-types.js";
export {
  AUDIT_REPORT_SECTIONS,
  SHAPE_RULE,
  parseAuditReport,
  type AuditReportSection,
  type AuditReportSectionResult,
  type ParsedAuditReport,
} from "./audit-report-shape.js";
export {
  describeScope,
  findingViolation,
  formatAuditReportViolation,
} from "./audit-report-wording.js";

/** Every rule a shape-checked report is held to. */
export const AUDIT_REPORT_RULES: readonly AuditReportRule[] = [
  scopesAreRepositoryFolders,
  everyCriterionOncePerScope,
  plainLanguageFields,
  notApplicableOnlyWhereItMayBe,
  provedNeedsFreshEvidence,
  locatorsResolve,
  questionsMatchFindings,
  trackerQuestionAsked,
  answersAreWhatWasTyped,
  probesAreWellFormed,
  dependentsOfUnreadSystemsAreUnknown,
  serverSideAuthorityNeedsPlatformRead,
  probesHoldNoCredentials,
  reportHoldsNoSecretValues,
];

/**
 * Check a candidate audit report.
 *
 * Shape comes first: a report that is malformed is returned with its shape
 * problems only, because the rules need a well-formed report to reason about.
 * @param candidate - Parsed JSON of any shape
 * @param context - The facts the report is checked against
 * @param rules - The rules to hold it to
 * @returns The report when nothing is wrong with it, and every violation
 *   otherwise
 */
export function validateAuditReport(
  candidate: unknown,
  context: AuditReportContext,
  rules: readonly AuditReportRule[] = AUDIT_REPORT_RULES
): ParsedAuditReport {
  const parsed = parseAuditReport(candidate);
  if (parsed.report === null) return parsed;
  const { report } = parsed;
  const violations = rules.flatMap(rule => rule(report, context));
  return { report: violations.length === 0 ? report : null, violations };
}
