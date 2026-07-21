#!/usr/bin/env node
/**
 * Shared doctor report helpers for the base Lisa doctor surface.
 *
 * The first doctor milestone needs a stable grouped output contract before the
 * repo adds real readiness probes. Keep this file dependency-free so future
 * doctor scripts can reuse it from plugin distributions and downstream repos.
 */
import { existsSync, readFileSync } from "node:fs";
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
 * it does not redefine the vocabulary. Evidence gathering lives in the
 * TypeScript CLI producers, which persist the authoritative per-dimension
 * result to `.lisa/readiness.json`; this surface projects that result. When no
 * usable report is on disk, each dimension renders `SKIP` carrying the reason
 * it was not assessed — reported, never silently omitted, per the shipped
 * contract.
 * @type {readonly { id: string, question: string, skipReason: string }[]}
 */
const REPOSITORY_READINESS_DIMENSIONS = [
  {
    id: "context-routing",
    question:
      "Can an agent recover the real job from what is written down (integration-access-layer, wiki-knowledge-source, config-resolution)?",
    skipReason:
      "Context/routing evidence is assessed by the agent-ready wiring (RRR-4, #1856); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "capabilities-tools",
    question:
      "Is every tool the work needs provably reachable, not merely installed (tool-access-gate)?",
    skipReason:
      "Tool reachability needs a live read-only probe and can never be established from an offline read: the `tool-access-gate` rule names presence — a binary on `PATH`, a dependency in a manifest, a configured MCP server — as the anti-pattern, because it proves a tool was declared, never that a request through it succeeded. This dimension is therefore a deliberate, permanent reasoned SKIP on an offline pass rather than a not-yet-wired one; only a run that actually exercises the tools can answer it.",
  },
  {
    id: "domain-ownership",
    question:
      "Are the business rules, glossary, and danger zones owned and written down (agent-ready domain phase wiki pages)?",
    skipReason:
      "Domain-ownership evidence sources from agent-ready's danger-zone wiki pages, read by RRR-4 (#1856); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "execution-proof",
    question:
      "Can the claimed user-visible outcome be proved by running the system (verification, empirical-inquiry, claim-evidence-mapping)?",
    skipReason:
      "Execution/proof consumes qualification evidence and representative journeys wired by RRR-6 (#1858); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "feedback-guardrails",
    question:
      "Does a failing loop produce a named outcome and a runbook (automation-runbook-contract, observability-audit)?",
    skipReason:
      "Feedback/guardrails evidence is assessed by RRR-4 (#1856); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "dependencies-supply-chain",
    question:
      "Is there a confidence model for what the repo depends on (security-audit-handling)?",
    skipReason:
      "Dependencies/supply-chain evidence is assessed by RRR-4 (#1856); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "delivery-authority",
    question:
      "Does the thing that ships equal the thing that was validated, and does the shipping credential carry only the authority it needs (claim-archaeology, security-audit-handling)?",
    skipReason:
      "Delivery/authority blockers are populated by the blocker gate in RRR-5 (#1857); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
  {
    id: "proportionality",
    question:
      "Is the machinery proportional to the job, or is there scaffolding to subtract (repo-scope-split, #1742 subtraction candidates)?",
    skipReason:
      "Proportionality reuses the scaffolding-subtraction candidates surfaced by the journey work (RRR-6, #1858); no usable `.lisa/readiness.json` was found, so this dimension was not assessed here. Run `lisa doctor --offline --readiness` to produce the report, then re-run doctor.",
  },
];

/**
 * `schema_version` this surface knows how to project. A report stamped with any
 * other version is treated as unreadable rather than guessed at: the whole point
 * of the version stamp is that a reader may not invent a mapping it was never
 * told about.
 */
const READINESS_REPORT_SCHEMA_VERSION = 1;

/**
 * Longest operator-facing summary projected out of a CLI finding. Findings can
 * carry kilobytes of concatenated evidence (every offending workflow job, for
 * example); the doctor line is a headline, and the full text stays available in
 * `.lisa/readiness.json`.
 */
const READINESS_SUMMARY_MAX_LENGTH = 320;

/**
 * Resolve the single location the CLI writes the readiness report to. This
 * mirrors the CLI's `resolveReadinessReportPath` so relocating the artifact
 * stays a two-line change across both scorers.
 * @param {string} repoRoot
 * @returns {string}
 */
function resolveReadinessReportPath(repoRoot) {
  return path.join(repoRoot, ".lisa", "readiness.json");
}

/**
 * Read the CLI-authored readiness report, or `null` when there is nothing
 * trustworthy to project. Absence, unparseable JSON, an unknown
 * `schema_version`, and a missing `dimensions` array are all the same answer —
 * "the CLI readiness pass has not produced a result this surface can read" —
 * and none of them is evidence about the repository itself.
 * @param {string} repoRoot
 * @returns {{ dimensions: readonly Record<string, unknown>[], blockers: readonly Record<string, unknown>[], narrowedClaim: string, provenance: string } | null}
 */
function readReadinessReport(repoRoot) {
  const reportPath = resolveReadinessReportPath(repoRoot);
  if (!existsSync(reportPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.schema_version !== READINESS_REPORT_SCHEMA_VERSION ||
      !Array.isArray(parsed.dimensions)
    ) {
      return null;
    }
    return {
      dimensions: parsed.dimensions,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      // The narrowed claim is the sentence `readiness-rubric` requires whenever
      // a blocker stands ("...IS ready for supervised, single-ticket agent
      // work..."). Dropping it would hand the agent operator a bare NOT_READY
      // where the CLI hands them the fallback they can actually act on.
      narrowedClaim:
        typeof parsed.narrowed_claim === "string" ? parsed.narrowed_claim : "",
      // Stamped into every projected check so a months-old report cannot read
      // as current truth: this surface reflects a file, not a live assessment.
      provenance: describeReportProvenance(parsed),
    };
  } catch {
    return null;
  }
}

/**
 * Describe when the projected report was produced and by which Lisa version.
 * @param {Record<string, unknown>} parsed
 * @returns {string}
 */
function describeReportProvenance(parsed) {
  const generatedAt =
    typeof parsed.generated_at === "string" && parsed.generated_at.length > 0
      ? parsed.generated_at
      : "an unrecorded time";
  const version =
    typeof parsed.lisa_version === "string" && parsed.lisa_version.length > 0
      ? ` by Lisa ${parsed.lisa_version}`
      : "";
  return `generated ${generatedAt}${version}`;
}

/**
 * Pull the operator-facing sentence out of a dimension's findings. The CLI
 * producers write human text under `evidence` (an assessed dimension),
 * `reason` (a deliberately-unassessed one), or `observation` (a neutral note);
 * the rest of the finding is machine bookkeeping the blocker engine owns.
 * Reading only two of the three would print the dimension's question under a
 * FAIL, which reads as "nothing to report" exactly when there is most to say.
 * @param {readonly unknown[]} findings
 * @returns {string}
 */
function summarizeReadinessFindings(findings) {
  const sentences = findings
    .filter(finding => finding !== null && typeof finding === "object")
    .flatMap(finding => [finding.evidence, finding.reason, finding.observation])
    .filter(text => typeof text === "string" && text.trim().length > 0)
    .map(text => text.trim());
  if (sentences.length === 0) {
    return "";
  }
  const joined = sentences.join(" ");
  return joined.length > READINESS_SUMMARY_MAX_LENGTH
    ? `${joined.slice(0, READINESS_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
    : joined;
}

/**
 * Carry the CLI's not-established caveat onto every unassessed dimension. The
 * CLI headline says it out loud — "N of 8 dimensions were never assessed, so
 * this cannot say whether an unattended fleet may operate here" — and a reader
 * who sees a lone `SKIP` line without it can mistake silence for a clean bill
 * of health on that dimension.
 * @param {DoctorCheck} check
 * @param {readonly DoctorCheck[]} checks
 * @returns {DoctorCheck}
 */
function applyNotEstablishedCaveat(check, checks) {
  const unassessed = checks.filter(entry => entry.status === "SKIP").length;
  if (check.status !== "SKIP" || unassessed === 0) {
    return check;
  }
  return {
    ...check,
    observed: `${check.observed} NOT ESTABLISHED: ${unassessed} of ${checks.length} dimensions were never assessed, so this cannot say whether an unattended fleet may operate here.`,
  };
}

/**
 * Collect the ids of the standing ship blockers a dimension owns. Blockers with
 * no usable id are dropped rather than stringified, so a malformed record can
 * never render "Standing ship blocker(s): undefined" at an operator.
 * @param {{ id: string }} dimension
 * @param {{ blockers: readonly Record<string, unknown>[] }} report
 * @returns {readonly string[]}
 */
function standingBlockerIds(dimension, report) {
  return report.blockers
    .filter(
      blocker =>
        blocker !== null &&
        typeof blocker === "object" &&
        (blocker.dimension_id === dimension.id ||
          (Array.isArray(blocker.owning_dimensions) &&
            blocker.owning_dimensions.includes(dimension.id)))
    )
    .map(blocker => blocker.id)
    .filter(id => typeof id === "string" && id.length > 0)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

/**
 * Project one CLI dimension record into this surface's check shape, or `null`
 * when the record is absent or carries a status outside the shipped vocabulary
 * (the caller then falls back to the reasoned SKIP).
 * @param {{ id: string, question: string, skipReason: string }} dimension
 * @param {{ dimensions: readonly Record<string, unknown>[], blockers: readonly Record<string, unknown>[], narrowedClaim: string, provenance: string }} report
 * @returns {DoctorCheck | null}
 */
function projectReadinessDimension(dimension, report) {
  const record = report.dimensions.find(
    entry =>
      entry !== null && typeof entry === "object" && entry.id === dimension.id
  );
  if (!record || !DOCTOR_STATUSES.includes(record.status)) {
    return null;
  }
  const findings = Array.isArray(record.findings) ? record.findings : [];
  const summary = summarizeReadinessFindings(findings);
  const blockerIds = standingBlockerIds(dimension, report);

  return {
    id: dimension.id,
    // A standing blocker outranks the recorded label. Three CLI producers (B1
    // domain-ownership, B4 feedback-guardrails, B6 context-routing) record
    // `WARN` while standing a blocker, each stating in-line that "the blocker
    // engine never reads this status, so the finding flips the repository to
    // NOT_READY exactly as a FAIL would". Projecting that `WARN` verbatim would
    // score READY_WITH_WARNINGS on a repository the CLI calls NOT_READY — the
    // precise disagreement this bridge exists to eliminate. This still reflects
    // the CLI's decision rather than re-scoring: the CLI decided the blocker
    // stands and wrote it into `blockers[]`.
    status: blockerIds.length > 0 ? "FAIL" : record.status,
    summary: summary.length > 0 ? summary : dimension.question,
    observed: `${dimension.question} Projected from \`.lisa/readiness.json\` (schema_version ${READINESS_REPORT_SCHEMA_VERSION}, ${report.provenance}), the report the Lisa CLI readiness pass wrote.`,
    ...(blockerIds.length > 0
      ? {
          remediation:
            `Standing ship blocker(s): ${blockerIds.join(", ")}. See \`.lisa/readiness.json\` for the full evidence and the \`readiness-rubric\` rule for the blocker definitions.` +
            (report.narrowedClaim.length > 0 ? ` ${report.narrowedClaim}` : ""),
        }
      : {}),
  };
}

/**
 * Build the orthogonal "Repository readiness" doctor group ("may an agent fleet
 * operate here unattended?"), scored against the eight `readiness-rubric`
 * ownership dimensions. It is separate from the installation-readiness groups
 * and is appended in a fixed position by the readiness-mode caller; the eight
 * dimension checks render in fixed order.
 *
 * The blocker engine and the evidence producers live in the TypeScript CLI,
 * which is the single source of truth; this surface is a bridge, not a second
 * implementation (#1902). It projects whatever the CLI persisted to
 * `.lisa/readiness.json` so an operator running `/lisa:doctor` through any
 * coding agent gets the same readiness answer the CLI gives. When no usable
 * report exists, every unmatched dimension renders `SKIP` with its reason:
 * absence means the readiness pass has not run, never that the repository is
 * clean, so a pass or fail is never manufactured from it.
 * @param {string} root
 * @returns {DoctorGroup}
 */
export function createRepositoryReadinessDoctorGroup(root = process.cwd()) {
  const report = readReadinessReport(path.resolve(root));
  const checks = REPOSITORY_READINESS_DIMENSIONS.map(
    dimension =>
      (report === null
        ? null
        : projectReadinessDimension(dimension, report)) ?? {
        id: dimension.id,
        status: "SKIP",
        summary: dimension.question,
        observed:
          report === null
            ? dimension.skipReason
            : `${dimension.question} \`.lisa/readiness.json\` carries no usable record for this dimension, so it was not assessed here. Re-run \`lisa doctor --offline --readiness\` to regenerate the report.`,
      }
  );
  return {
    id: "repository-readiness",
    title: "Repository readiness",
    checks: checks.map(check => applyNotEstablishedCaveat(check, checks)),
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
