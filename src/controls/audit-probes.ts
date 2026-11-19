/**
 * Reading the probes of an audit report: which outside system was read, and
 * which findings wait on one that was not.
 *
 * Every later step that needs to know whether an outside system could be
 * read asks here instead of walking the list itself, so the question "may
 * this finding be relied on?" has one answer everywhere.
 * @module controls/audit-probes
 */
import {
  PROBE_REACHABLE,
  type AuditProbe,
  type AuditProbeDependent,
} from "./audit-probe-types.js";
import type { AuditReport } from "./audit-report-types.js";

/**
 * Find the probe recorded under an id.
 * @param report - A shape-checked report
 * @param id - The probe's id, for example `hosting-platform`
 * @returns The probe, or `null` when the system was not probed
 */
export function probeOf(report: AuditReport, id: string): AuditProbe | null {
  return report.probes.find(probe => probe.id === id) ?? null;
}

/**
 * Tell whether a probe got an answer.
 * @param probe - The probe
 * @returns Whether its result is `reachable`
 */
export function isReached(probe: AuditProbe): boolean {
  return probe.result === PROBE_REACHABLE;
}

/**
 * Tell whether a probe lists a finding as depending on it.
 * @param probe - The probe
 * @param finding - The finding, by criterion and scope
 * @returns Whether the finding is in the probe's `needed_by`
 */
export function isNeededBy(
  probe: AuditProbe,
  finding: AuditProbeDependent
): boolean {
  return probe.needed_by.some(
    dependent =>
      dependent.criterion === finding.criterion &&
      dependent.scope === finding.scope
  );
}

/**
 * The probes that stand between a finding and an answer: the ones the
 * finding depends on that did not get one.
 * @param report - A shape-checked report
 * @param finding - The finding, by criterion and scope
 * @returns Those probes, in the report's order; empty when the finding
 *   depends on no outside system, or every one it depends on answered
 */
export function unreachedProbesOf(
  report: AuditReport,
  finding: AuditProbeDependent
): readonly AuditProbe[] {
  return report.probes.filter(
    probe => !isReached(probe) && isNeededBy(probe, finding)
  );
}
