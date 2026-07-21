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
 * The eight repository-readiness ownership dimensions, in fixed render order,
 * defined once by the `readiness-rubric` rule. This group consumes that rubric;
 * it does not redefine the vocabulary. Evidence gathering for each dimension is
 * wired by later PRD #1739 tickets, so every dimension renders `SKIP` with a
 * reason here — reported, never silently omitted, per the shipped contract.
 * @type {readonly { id: string, question: string, skipReason: string }[]}
 */
const REPOSITORY_READINESS_DIMENSIONS = [
  {
    id: "context-routing",
    question:
      "Can an agent recover the real job from what is written down (integration-access-layer, wiki-knowledge-source, config-resolution)?",
    skipReason:
      "Context/routing evidence is assessed by the agent-ready wiring (RRR-4, #1856); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "capabilities-tools",
    question:
      "Is every tool the work needs provably reachable, not merely installed (tool-access-gate)?",
    skipReason:
      "Capabilities/tools evidence is gathered by the journey-execution wiring (RRR-6, #1858); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "domain-ownership",
    question:
      "Are the business rules, glossary, and danger zones owned and written down (agent-ready domain phase wiki pages)?",
    skipReason:
      "Domain-ownership evidence sources from agent-ready's danger-zone wiki pages, read by RRR-4 (#1856); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "execution-proof",
    question:
      "Can the claimed user-visible outcome be proved by running the system (verification, empirical-inquiry, claim-evidence-mapping)?",
    skipReason:
      "Execution/proof consumes qualification evidence and representative journeys wired by RRR-6 (#1858); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "feedback-guardrails",
    question:
      "Does a failing loop produce a named outcome and a runbook (automation-runbook-contract, observability-audit)?",
    skipReason:
      "Feedback/guardrails evidence is assessed by RRR-4 (#1856); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "dependencies-supply-chain",
    question:
      "Is there a confidence model for what the repo depends on (security-audit-handling)?",
    skipReason:
      "Dependencies/supply-chain evidence is assessed by RRR-4 (#1856); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "delivery-authority",
    question:
      "Does the thing that ships equal the thing that was validated, and does the shipping credential carry only the authority it needs (claim-archaeology, security-audit-handling)?",
    skipReason:
      "Delivery/authority blockers are populated by the blocker gate in RRR-5 (#1857); no readiness probe is wired in this Lisa version.",
  },
  {
    id: "proportionality",
    question:
      "Is the machinery proportional to the job, or is there scaffolding to subtract (repo-scope-split, #1742 subtraction candidates)?",
    skipReason:
      "Proportionality reuses the scaffolding-subtraction candidates surfaced by the journey work (RRR-6, #1858); no readiness probe is wired in this Lisa version.",
  },
];

/**
 * Build the orthogonal "Repository readiness" doctor group ("may an agent fleet
 * operate here unattended?"), scored against the eight `readiness-rubric`
 * ownership dimensions. It is separate from the installation-readiness groups
 * and is appended in a fixed position by the readiness-mode caller; the eight
 * dimension checks render in fixed order. In this Lisa version every dimension
 * is `SKIP` with a stated reason because the evidence-gathering surfaces ship
 * with later PRD #1739 tickets — reported, never silently omitted.
 * @param {string} root
 * @returns {DoctorGroup}
 */
export function createRepositoryReadinessDoctorGroup(root = process.cwd()) {
  void path.resolve(root);
  return {
    id: "repository-readiness",
    title: "Repository readiness",
    checks: REPOSITORY_READINESS_DIMENSIONS.map(dimension => ({
      id: dimension.id,
      status: "SKIP",
      summary: dimension.question,
      observed: dimension.skipReason,
    })),
  };
}

/**
 * Group id of the orthogonal repository-readiness assessment. Named once so the
 * verdict scorer can hold that group — and only that group — to the stricter
 * "assessed or it does not count" bar.
 */
const REPOSITORY_READINESS_GROUP_ID = "repository-readiness";

/**
 * Score the doctor groups onto the shipped verdict ladder.
 *
 * `SKIP` is benign for the installation groups — "no wiki/ directory here" is a
 * genuine not-applicable, so an all-SKIP installation report is still `READY`.
 * It is NOT benign for the repository-readiness group: there a `SKIP` means the
 * ownership dimension was never assessed, and calling zero evidence `READY`
 * emits a green unattended-fleet claim backed by nothing (#1897). So an
 * unassessed readiness dimension downgrades to `READY_WITH_WARNINGS`, while a
 * fully-`PASS` readiness group still reaches `READY`.
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
  const readinessUnassessed = groups
    .filter(group => group.id === REPOSITORY_READINESS_GROUP_ID)
    .flatMap(group => group.checks.map(normalizeCheck))
    .some(check => check.status === "SKIP");
  return readinessUnassessed ? "READY_WITH_WARNINGS" : "READY";
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
