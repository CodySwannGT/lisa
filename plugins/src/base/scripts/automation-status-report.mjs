#!/usr/bin/env node
/**
 * Shared automation-status report helpers for the base Lisa operator surface.
 *
 * Keep this dependency-free so the grouped fleet rendering contract can ship in
 * plugin distributions and downstream repos before the runtime adapters land.
 */

export const AUTOMATION_HEALTH_STATUSES = [
  "HEALTHY",
  "MISSING",
  "UNSUPPORTED",
  "DRIFTED",
  "STALE",
  "FAILING",
];

export const AUTOMATION_FLEET_VERDICTS = [
  "HEALTHY",
  "PARTIAL_SUPPORT",
  "ATTENTION_NEEDED",
];

/**
 * @typedef {"HEALTHY" | "MISSING" | "UNSUPPORTED" | "DRIFTED" | "STALE" | "FAILING"} AutomationHealthStatus
 * @typedef {"HEALTHY" | "PARTIAL_SUPPORT" | "ATTENTION_NEEDED"} AutomationFleetVerdict
 *
 * @typedef {{
 *   readonly id: string
 *   readonly status: AutomationHealthStatus
 *   readonly summary: string
 *   readonly expectedCadence?: string
 *   readonly expectedCommand?: string
 *   readonly observed?: string
 *   readonly remediation?: string
 * }} AutomationStatusItem
 *
 * @typedef {{
 *   readonly id: string
 *   readonly title: string
 *   readonly items: readonly AutomationStatusItem[]
 * }} AutomationStatusGroup
 *
 * @typedef {{
 *   readonly runtime?: string
 *   readonly generatedAt?: string
 *   readonly groups: readonly AutomationStatusGroup[]
 * }} AutomationStatusReportInput
 */

/**
 * @param {readonly AutomationStatusGroup[]} groups
 * @returns {AutomationFleetVerdict}
 */
export function computeAutomationFleetVerdict(groups) {
  const items = groups.flatMap(group => group.items);
  if (
    items.some(item =>
      ["MISSING", "DRIFTED", "STALE", "FAILING"].includes(item.status)
    )
  ) {
    return "ATTENTION_NEEDED";
  }
  if (items.some(item => item.status === "UNSUPPORTED")) {
    return "PARTIAL_SUPPORT";
  }
  return "HEALTHY";
}

/**
 * @param {readonly AutomationStatusGroup[]} groups
 * @returns {Record<AutomationHealthStatus, number>}
 */
export function countAutomationHealthStatuses(groups) {
  return groups
    .flatMap(group => group.items)
    .reduce(
      (counts, item) => ({
        ...counts,
        [item.status]: counts[item.status] + 1,
      }),
      {
        HEALTHY: 0,
        MISSING: 0,
        UNSUPPORTED: 0,
        DRIFTED: 0,
        STALE: 0,
        FAILING: 0,
      }
    );
}

/**
 * @param {AutomationStatusReportInput} input
 * @returns {{ readonly verdict: AutomationFleetVerdict, readonly counts: Record<AutomationHealthStatus, number>, readonly text: string }}
 */
export function renderAutomationStatusReport(input) {
  const groups = input.groups.map(normalizeGroup);
  const verdict = computeAutomationFleetVerdict(groups);
  const counts = countAutomationHealthStatuses(groups);
  const lines = [
    `Overall verdict: ${verdict}`,
    `Counts: ${AUTOMATION_HEALTH_STATUSES.map(status => `${counts[status]} ${status}`).join(", ")}`,
  ];

  if (input.runtime) {
    lines.push(`Runtime inspected: ${input.runtime}`);
  }

  if (input.generatedAt) {
    lines.push(`Generated at: ${input.generatedAt}`);
  }

  for (const group of groups) {
    lines.push("", `${group.id}. ${group.title}`);
    if (group.items.length === 0) {
      lines.push(
        "- UNSUPPORTED empty-group: no automations expected in this group"
      );
      continue;
    }

    for (const item of group.items) {
      lines.push(`- ${item.status} ${item.id}: ${item.summary}`);
      if (item.expectedCadence || item.expectedCommand) {
        const cadence = item.expectedCadence ?? "cadence unavailable";
        const command = item.expectedCommand ?? "command unavailable";
        lines.push(`  Expected: ${cadence} -> ${command}`);
      }
      if (item.observed) {
        lines.push(`  Observed: ${item.observed}`);
      }
      if (item.remediation) {
        lines.push(`  Remediation: ${item.remediation}`);
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
 * @param {AutomationStatusGroup} group
 * @returns {AutomationStatusGroup}
 */
function normalizeGroup(group) {
  return {
    ...group,
    items: group.items.map(normalizeItem),
  };
}

/**
 * @param {AutomationStatusItem} item
 * @returns {AutomationStatusItem}
 */
function normalizeItem(item) {
  const normalizedStatus = AUTOMATION_HEALTH_STATUSES.includes(item.status)
    ? item.status
    : "FAILING";

  return {
    ...item,
    status: normalizedStatus,
  };
}
