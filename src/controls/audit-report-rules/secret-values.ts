/**
 * Rule: the audit report refers to a secret by its name and never holds its
 * value.
 *
 * The report is committed and shared, so a credential copied into it would
 * be published. Everything in it was written by the audit or typed by a
 * person, and whoever wrote a value can take it out, so a report that holds
 * one is refused rather than rewritten: nothing is rendered from it until
 * the value is gone.
 *
 * Every piece of text in the report is looked at: each finding's plain
 * sentences, its mechanisms' tools, commands and file paths, each question
 * and its candidate answers, and each recorded answer. The probes are looked
 * at by `./probe-secrets.ts`, which names a probe the way the audit skill
 * tells an agent to read it; both rules ask the same scanner
 * (`../secret-scan.ts`), so they cannot disagree about a string.
 *
 * A message from this rule names the file and the place in it, by the keys
 * and positions that lead there: `findings[3].mechanisms[0].command`. It
 * never repeats what it found, and it carries no requirement id or folder,
 * because either of those could be where the value is.
 * @module controls/audit-report-rules/secret-values
 */
import {
  AUDIT_REPORT_JSON_PATH,
  type AuditReportRule,
} from "../audit-report-types.js";
import {
  scanJsonForCredentials,
  secretFindingLine,
} from "../secret-scan-json.js";

/** The name this rule's violations carry. */
export const SECRET_VALUES_RULE = "secret-values";

/**
 * Nothing in the report outside its probes is shaped like a credential.
 * @param report - The report
 * @returns One violation per place and shape, in the order of the report
 */
export const reportHoldsNoSecretValues: AuditReportRule = report => {
  const { probes: _probes, ...rest } = report;
  return scanJsonForCredentials(rest).map(finding => ({
    rule: SECRET_VALUES_RULE,
    message: secretFindingLine(AUDIT_REPORT_JSON_PATH, finding),
  }));
};
