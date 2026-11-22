/**
 * Rule: a finding that depends on an outside system the audit could not read
 * is never reported as answered.
 *
 * A tool being configured does not mean an agent can reach it. When a probe
 * did not get an answer (the read was refused, or was never tried), nothing
 * the audit read shows where the requirements that depend on that system
 * stand. So each finding the probe lists must say exactly that: its state is
 * `unknown`, whatever a file in the repository or an old evidence record
 * suggests, and its next step names the access that is missing in the probe's
 * own words, so the operator is told once and told the same thing.
 *
 * Which finding depends on which system is read from the probe's `needed_by`
 * and from nowhere else. Nothing is inferred from a sentence.
 * @module controls/audit-report-rules/probe-dependents
 */
import type { AuditProbe } from "../audit-probe-types.js";
import { isNeededBy, isReached } from "../audit-probes.js";
import type {
  AuditFinding,
  AuditReportRule,
  AuditReportViolation,
} from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";

/** The name this rule's violations carry. */
export const PROBE_DEPENDENTS_RULE = "probe-dependents";

/** The only state a finding may be in while a system it needs is unread. */
const UNREAD_STATE = "unknown";

/**
 * Reduce text to what is compared: one line, in lower case.
 * @param text - Text from the report
 * @returns The text with every run of white space as one space
 */
function comparable(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * Say how a probe ended without an answer.
 * @param probe - A probe whose result is not `reachable`
 * @returns The words for a message
 */
function unread(probe: AuditProbe): string {
  return probe.result === "not-attempted"
    ? "which the audit did not try to reach"
    : "which the audit could not reach";
}

/**
 * Hold one finding to one probe it depends on that got no answer.
 * @param finding - The finding
 * @param probe - The probe
 * @returns The violation, or nothing when the finding says what it must
 */
function unreadViolations(
  finding: AuditFinding,
  probe: AuditProbe
): readonly AuditReportViolation[] {
  const depends = `This finding depends on the outside system probed as "${probe.id}", ${unread(probe)}`;
  if (finding.state !== UNREAD_STATE) {
    return [
      findingViolation(
        PROBE_DEPENDENTS_RULE,
        finding,
        `${depends}, so nothing shows whether the requirement is met. Change its state to "${UNREAD_STATE}" and say in "next" what access is needed.`,
        "state"
      ),
    ];
  }
  return comparable(finding.next).includes(
    comparable(probe.access_needed ?? "")
  )
    ? []
    : [
        findingViolation(
          PROBE_DEPENDENTS_RULE,
          finding,
          `${depends}, but its "next" field does not say what access is needed. Copy the probe's "access_needed" into it, word for word.`,
          "next"
        ),
      ];
}

/**
 * Every finding a probe without an answer lists is `unknown` and names the
 * access that is missing.
 * @param report - The report
 * @returns The violations found
 */
export const dependentsOfUnreadSystemsAreUnknown: AuditReportRule = report =>
  report.probes
    .filter(probe => !isReached(probe))
    .flatMap(probe =>
      report.findings
        .filter(finding => isNeededBy(probe, finding))
        .flatMap(finding => unreadViolations(finding, probe))
    );
