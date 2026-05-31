#!/usr/bin/env node
/**
 * Shared doctor report helpers for the base Lisa doctor surface.
 *
 * The first doctor milestone needs a stable grouped output contract before the
 * repo adds real readiness probes. Keep this file dependency-free so future
 * doctor scripts can reuse it from plugin distributions and downstream repos.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { getPluginSyncResult } from "./plugin-sync-explain.mjs";

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
 * @param {string} root
 * @returns {DoctorGroup}
 */
export function createPluginSyncDoctorGroup(root = process.cwd()) {
  const repoRoot = path.resolve(root);
  if (
    !existsSync(path.join(repoRoot, "plugins", "src")) &&
    !existsSync(path.join(repoRoot, "plugins"))
  ) {
    return {
      id: "plugin-sync",
      title: "Plugin source/generated sync",
      checks: [
        {
          id: "plugin-sync",
          status: "SKIP",
          summary: "plugin sync check is not applicable",
          observed:
            "No plugins/ or plugins/src/ directory was found in this repository.",
        },
      ],
    };
  }

  try {
    const result = getPluginSyncResult(repoRoot);
    if (!result.readOnly) {
      return {
        id: "plugin-sync",
        title: "Plugin source/generated sync",
        checks: [
          {
            id: "plugin-sync",
            status: "FAIL",
            summary: "plugin sync readiness check mutated the working tree",
            observed:
              "Git status changed while collecting plugin sync evidence.",
            remediation:
              "Run `git status --short`, inspect the unexpected changes, and fix plugin-sync-explain before trusting doctor output.",
          },
        ],
      };
    }

    return {
      id: "plugin-sync",
      title: "Plugin source/generated sync",
      checks: [
        {
          id: "plugin-sync",
          status: result.verdict,
          summary:
            result.verdict === "PASS"
              ? "plugin source and generated artifacts are in sync"
              : `plugin sync drift detected: ${result.driftClass}`,
          observed: renderPluginSyncObserved(result),
          remediation: renderPluginSyncRemediation(result),
        },
      ],
    };
  } catch (error) {
    return {
      id: "plugin-sync",
      title: "Plugin source/generated sync",
      checks: [
        {
          id: "plugin-sync",
          status: "FAIL",
          summary: "plugin sync readiness check failed",
          observed: error instanceof Error ? error.message : String(error),
          remediation:
            "Run `/lisa:plugin-sync-explain` or `bun run check:plugins` to inspect plugin sync health directly.",
        },
      ],
    };
  }
}

/**
 * @param {readonly DoctorGroup[]} groups
 * @returns {DoctorVerdict}
 */
export function computeDoctorVerdict(groups) {
  const checks = groups.flatMap(group => group.checks.map(normalizeCheck));
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
    .flatMap(group => group.checks.map(normalizeCheck))
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
  const checks =
    group.checks.length === 0
      ? [
          {
            id: "empty-group",
            status: "SKIP",
            summary: "no checks registered yet",
          },
        ]
      : group.checks.map(normalizeCheck);

  return {
    ...group,
    checks,
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

/**
 * @param {import("./plugin-sync-explain.mjs").PluginSyncResult} result
 * @returns {string}
 */
function renderPluginSyncObserved(result) {
  if (result.verdict === "PASS") {
    return "Drift class IN_SYNC; plugin sync evidence was collected read-only.";
  }
  const paths = result.affectedPaths.length
    ? result.affectedPaths.join(", ")
    : "none";
  return `Drift class ${result.driftClass}; affected paths: ${paths}.`;
}

/**
 * @param {import("./plugin-sync-explain.mjs").PluginSyncResult} result
 * @returns {string | undefined}
 */
function renderPluginSyncRemediation(result) {
  if (result.verdict === "PASS") {
    return undefined;
  }

  const nextAction = pluginSyncNextAction(result.driftClass);
  const details = result.remediations
    .map(item => `${item.path}: ${item.nextAction}`)
    .join(" ");
  const explain =
    "Run `/lisa:plugin-sync-explain` or `bun run check:plugins` for the detailed drift report.";

  return [nextAction, details, explain].filter(Boolean).join(" ");
}

/**
 * @param {string} driftClass
 * @returns {string}
 */
function pluginSyncNextAction(driftClass) {
  switch (driftClass) {
    case "SOURCE_NOT_BUILT":
      return "Next action: run `bun run build:plugins && bun run check:plugins`, then commit source plus regenerated plugin artifacts.";
    case "OUT_OF_SYNC":
      return "Next action: review source and generated plugin changes, keep `plugins/src` authoritative, then run `bun run build:plugins && bun run check:plugins`.";
    case "GENERATED_ONLY":
      return "Next action: move generated-only edits upstream to `plugins/src`, or remove the generated artifact drift if it should not ship.";
    case "MARKETPLACE_REGISTRATION_DRIFT":
      return "Next action: align marketplace registration with the built plugin manifests, or remove stale marketplace entries.";
    default:
      return `Next action: inspect plugin sync drift class ${driftClass}.`;
  }
}
