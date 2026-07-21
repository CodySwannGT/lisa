import { rename, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";
import type { DoctorCheck } from "./doctor.js";
import { getPackageVersion } from "./version.js";

/** Doctor check name for the repository-readiness collector. */
const REPOSITORY_READINESS_CHECK_NAME = "Repository readiness";

/** Repo-relative display path for the persisted readiness report. */
const READINESS_REPORT_DISPLAY_PATH = path.join(".lisa", "readiness.json");

/**
 * Schema version stamped into `.lisa/readiness.json`. Bump only alongside a
 * deliberate shape change; readers key off this to stay forward-compatible.
 */
export const READINESS_SCHEMA_VERSION = 1;

/** Verdict ladder reused from the shipped doctor surface (readiness-rubric). */
type ReadinessVerdict = "READY" | "READY_WITH_WARNINGS" | "NOT_READY";

/** Per-dimension status, mirroring the shared doctor `DOCTOR_STATUSES`. */
type ReadinessStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

/** One readiness dimension descriptor. */
interface ReadinessDimensionSpec {
  readonly id: string;
  readonly question: string;
  readonly skipReason: string;
}

/**
 * The eight ownership dimensions, in fixed render order, defined once by the
 * `readiness-rubric` rule (RRR-1, #1853). This collector consumes that rubric —
 * it does not redefine the vocabulary. Evidence gathering for each dimension is
 * wired by later PRD #1739 tickets (RRR-4/5/6); until then every dimension
 * renders `SKIP` with a reason, per the shipped never-silently-omit contract.
 */
const READINESS_DIMENSIONS: readonly ReadinessDimensionSpec[] = [
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

/** The eight ownership dimension ids, in fixed render order. */
export const READINESS_DIMENSION_IDS: readonly string[] =
  READINESS_DIMENSIONS.map(dimension => dimension.id);

/** A persisted per-dimension record inside `.lisa/readiness.json`. */
interface ReadinessDimensionRecord {
  readonly id: string;
  readonly status: ReadinessStatus;
  readonly findings: readonly unknown[];
}

/** The persisted `.lisa/readiness.json` shape (schema_version 1). */
interface ReadinessReport {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly lisa_version: string;
  readonly worker_signature: string;
  readonly verdict: ReadinessVerdict;
  readonly narrowed_claim: null;
  readonly blockers: readonly unknown[];
  readonly blocker_count: number;
  readonly dimensions: readonly ReadinessDimensionRecord[];
}

/**
 * Resolve the single location every reader and writer uses for the persisted
 * readiness report. Centralizing the path here is intake decision O2's
 * mitigation: relocating the artifact (for example to
 * `wiki/state/agent-ready/readiness.json`) is a one-line change with no other
 * caller to update.
 * @param root - Project root to resolve the report under
 * @returns Absolute path to `.lisa/readiness.json`
 */
export function resolveReadinessReportPath(root: string): string {
  return path.join(root, ".lisa", "readiness.json");
}

/**
 * Assess repository readiness and persist the report to `.lisa/readiness.json`.
 *
 * This is the flag-gated collector `runDoctor` appends only when
 * `options.readiness` is true, so the default doctor path stays byte-identical.
 * It is warn-only per intake decision O1: it never returns `fail` and never
 * changes doctor's exit-code semantics. Every dimension is reported (never
 * silently omitted); in this Lisa version each renders `SKIP` with a reason
 * because the evidence-gathering surfaces ship with later PRD #1739 tickets.
 * Persistence is atomic and never throws — a write error degrades the check to
 * `warn` instead of aborting the run.
 * @param targetPath - Project path to assess and persist under
 * @returns Doctor check result
 */
export async function checkRepositoryReadiness(
  targetPath: string
): Promise<DoctorCheck> {
  const dimensions: readonly ReadinessDimensionRecord[] =
    READINESS_DIMENSIONS.map(dimension => ({
      id: dimension.id,
      status: "SKIP",
      findings: [],
    }));
  const verdict = computeReadinessVerdict(dimensions);
  const report: ReadinessReport = {
    schema_version: READINESS_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    lisa_version: resolveLisaVersion(),
    worker_signature: currentWorkerSignature(),
    verdict,
    narrowed_claim: null,
    blockers: [],
    blocker_count: 0,
    dimensions,
  };

  const reportPath = resolveReadinessReportPath(targetPath);
  try {
    await persistReadinessReport(reportPath, report);
  } catch (error) {
    return {
      name: REPOSITORY_READINESS_CHECK_NAME,
      status: "warn",
      detail:
        `Repository readiness assessed: ${verdict} (8 dimensions, all SKIP pending ` +
        `evidence wiring). Could not persist ${READINESS_REPORT_DISPLAY_PATH}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    name: REPOSITORY_READINESS_CHECK_NAME,
    status: verdict === "READY" ? "ok" : "warn",
    detail:
      `Repository readiness assessed: ${verdict} across 8 ownership dimensions ` +
      `(all SKIP pending evidence wiring in later PRD #1739 tickets; see readiness-rubric). ` +
      `Report written to ${READINESS_REPORT_DISPLAY_PATH} (schema_version ${READINESS_SCHEMA_VERSION}).`,
  };
}

/**
 * Reduce per-dimension statuses to the shipped verdict ladder. FAIL wins over
 * WARN, WARN over the rest; a report of only PASS/SKIP is READY.
 * @param dimensions - Per-dimension records
 * @returns Overall verdict
 */
function computeReadinessVerdict(
  dimensions: readonly ReadinessDimensionRecord[]
): ReadinessVerdict {
  if (dimensions.some(dimension => dimension.status === "FAIL")) {
    return "NOT_READY";
  }
  if (dimensions.some(dimension => dimension.status === "WARN")) {
    return "READY_WITH_WARNINGS";
  }
  return "READY";
}

/**
 * Atomically write the readiness report: write a sibling temp file, then rename
 * it into place so a reader never observes a partial document.
 * @param reportPath - Destination path
 * @param report - Report to persist
 */
async function persistReadinessReport(
  reportPath: string,
  report: ReadinessReport
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(tempPath, reportPath);
}

/**
 * Resolve Lisa's package version for the persisted stamp, degrading to
 * `"unknown"` rather than throwing when package metadata cannot be read.
 * @returns Lisa version string
 */
function resolveLisaVersion(): string {
  try {
    return getPackageVersion();
  } catch {
    return "unknown";
  }
}

/**
 * Build the current runtime worker signature the readiness stamp records. This
 * mirrors the worker-epoch host/model/version identity so #1740 can reuse the
 * same stamp (sibling-boundary decision).
 * @returns `host/model/version` signature string
 */
function currentWorkerSignature(): string {
  const env = process["env"];
  const host = (
    env.LISA_WORKER_HOST ??
    env.LISA_REMOTE_AGENT ??
    (env.CODEX_HOME || env.CODEX_SANDBOX
      ? "codex"
      : env.CLAUDECODE
        ? "claude"
        : "unknown")
  ).toLowerCase();
  const model = env.LISA_WORKER_MODEL ?? env.CODEX_MODEL ?? "unknown";
  const version = env.LISA_WORKER_VERSION ?? env.CODEX_VERSION ?? "unknown";
  return `${host}/${model}/${version}`;
}
