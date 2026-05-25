#!/usr/bin/env node
/**
 * Shared doctor report helpers for the base Lisa doctor surface.
 *
 * The first doctor milestone needs a stable grouped output contract before the
 * repo adds real readiness probes. Keep this file dependency-free so future
 * doctor scripts can reuse it from plugin distributions and downstream repos.
 */

export const DOCTOR_STATUSES = ["PASS", "WARN", "FAIL", "SKIP"];
export const DOCTOR_VERDICTS = ["READY", "READY_WITH_WARNINGS", "NOT_READY"];

/**
 * @typedef {"PASS" | "WARN" | "FAIL" | "SKIP"} DoctorStatus
 * @typedef {"READY" | "READY_WITH_WARNINGS" | "NOT_READY"} DoctorVerdict
 *
 * @typedef {{
 *   readonly id: string
 *   readonly status: DoctorStatus
 *   readonly summary: string
 *   readonly observed?: string
 *   readonly remediation?: string
 * }} DoctorCheck
 *
 * @typedef {{
 *   readonly id: string
 *   readonly title: string
 *   readonly checks: readonly DoctorCheck[]
 * }} DoctorGroup
 *
 * @typedef {{
 *   readonly generatedAt?: string
 *   readonly groups: readonly DoctorGroup[]
 * }} DoctorReportInput
 */

/**
 * @param {readonly DoctorGroup[]} groups
 * @returns {DoctorVerdict}
 */
export function computeDoctorVerdict(groups) {
  const checks = groups.flatMap(group => group.checks);
  if (checks.some(check => check.status === "FAIL")) {
    return "NOT_READY";
  }
  if (checks.some(check => check.status === "WARN")) {
    return "READY_WITH_WARNINGS";
  }
  return "READY";
}

/**
 * @param {readonly DoctorGroup[]} groups
 * @returns {Record<DoctorStatus, number>}
 */
export function countDoctorStatuses(groups) {
  return groups
    .flatMap(group => group.checks)
    .reduce(
      (counts, check) => ({
        ...counts,
        [check.status]: counts[check.status] + 1,
      }),
      { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 }
    );
}

/**
 * @param {DoctorReportInput} input
 * @returns {{ readonly verdict: DoctorVerdict, readonly counts: Record<DoctorStatus, number>, readonly text: string }}
 */
export function renderDoctorReport(input) {
  const groups = input.groups.map(normalizeGroup);
  const verdict = computeDoctorVerdict(groups);
  const counts = countDoctorStatuses(groups);
  const lines = [
    `Overall verdict: ${verdict}`,
    `Counts: ${DOCTOR_STATUSES.map(status => `${counts[status]} ${status}`).join(", ")}`,
  ];

  if (input.generatedAt) {
    lines.push(`Generated at: ${input.generatedAt}`);
  }

  for (const group of groups) {
    lines.push("", `${group.id}. ${group.title}`);
    if (group.checks.length === 0) {
      lines.push("- SKIP empty-group: no checks registered yet");
      continue;
    }
    for (const check of group.checks) {
      lines.push(`- ${check.status} ${check.id}: ${check.summary}`);
      if (check.observed) {
        lines.push(`  Observed: ${check.observed}`);
      }
      if (check.remediation) {
        lines.push(`  Remediation: ${check.remediation}`);
      }
    }
  }

  return {
    verdict,
    counts,
    text: `${lines.join("\n")}\n`,
  };
}

/**
 * @param {DoctorGroup} group
 * @returns {DoctorGroup}
 */
function normalizeGroup(group) {
  return {
    ...group,
    checks: group.checks.map(normalizeCheck),
  };
}

/**
 * @param {DoctorCheck} check
 * @returns {DoctorCheck}
 */
function normalizeCheck(check) {
  const normalizedStatus = DOCTOR_STATUSES.includes(check.status)
    ? check.status
    : "FAIL";
  return {
    ...check,
    status: normalizedStatus,
  };
}
