import { rename, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";
import type { DoctorCheck } from "./doctor.js";
import {
  assessReadiness,
  type DetectedBlocker,
  type ReadinessDimensionInput,
  type ReadinessVerdict,
} from "./doctor-readiness-blockers.js";
import {
  DELIVERY_AUTHORITY_DIMENSION_ID,
  assessDeliveryAuthorityDimension,
} from "./doctor-readiness-delivery.js";
import {
  EXECUTION_PROOF_DIMENSION_ID,
  PROPORTIONALITY_DIMENSION_ID,
  assessExecutionProofDimension,
  assessProportionalityDimension,
} from "./doctor-readiness-journey.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import { getPackageVersion } from "./version.js";

// Re-export the blocker-gate surface (RRR-5, #1857) so `.lisa/readiness.json`
// readers and tests keep one import path even though the gate lives in a
// sibling module for file-size hygiene.
export {
  CLAIM_EVIDENCE_UNAVAILABLE_REASON,
  SHIP_BLOCKER_IDS,
  assessProvabilityBlocker,
  assessReadiness,
  computeNarrowedClaim,
  detectShipBlockers,
} from "./doctor-readiness-blockers.js";
export type {
  BlockerDetectionOptions,
  DetectedBlocker,
  ProvabilityAssessment,
  ReadinessAssessment,
  ReadinessDimensionInput,
  ReadinessVerdict,
  ShipBlockerId,
} from "./doctor-readiness-blockers.js";

/** Doctor check name for the repository-readiness collector. */
const REPOSITORY_READINESS_CHECK_NAME = "Repository readiness";

/** Repo-relative display path for the persisted readiness report. */
const READINESS_REPORT_DISPLAY_PATH = path.join(".lisa", "readiness.json");

/**
 * Schema version stamped into `.lisa/readiness.json`. Bump only alongside a
 * deliberate shape change; readers key off this to stay forward-compatible.
 */
export const READINESS_SCHEMA_VERSION = 1;

/**
 * One readiness dimension descriptor. `skipReason` is stated only for dimensions
 * whose evidence surface has not shipped yet: a dimension registered in
 * {@link DIMENSION_PRODUCERS} states its own reason when it cannot assess
 * something, so a second reason here would be dead text that drifts out of date.
 */
interface ReadinessDimensionSpec {
  readonly id: string;
  readonly question: string;
  readonly skipReason?: string;
}

/**
 * The eight ownership dimensions, in fixed render order, defined once by the
 * `readiness-rubric` rule (RRR-1, #1853). This collector consumes that rubric —
 * it does not redefine the vocabulary. Evidence gathering is wired dimension by
 * dimension (see `DIMENSION_PRODUCERS`); a dimension whose producer has not
 * shipped yet renders `SKIP` carrying the `skipReason` stated here, per the
 * shipped never-silently-omit contract (#1898).
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
  },
  {
    id: "proportionality",
    question:
      "Is the machinery proportional to the job, or is there scaffolding to subtract (repo-scope-split, #1742 subtraction candidates)?",
  },
];

/** The eight ownership dimension ids, in fixed render order. */
export const READINESS_DIMENSION_IDS: readonly string[] =
  READINESS_DIMENSIONS.map(dimension => dimension.id);

/** The persisted `.lisa/readiness.json` shape (schema_version 1). */
interface ReadinessReport {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly lisa_version: string;
  readonly worker_signature: string;
  readonly verdict: ReadinessVerdict;
  readonly narrowed_claim: string | null;
  readonly blockers: readonly DetectedBlocker[];
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
 * changes doctor's exit-code semantics — a standing blocker flips the readiness
 * verdict to `NOT_READY` but still emits a `warn` check, because the gate is on
 * the *claim*, not the *process*. Every dimension is reported (never silently
 * omitted), and a dimension whose evidence surface has not shipped yet renders
 * `SKIP` carrying the reason it was not assessed (#1898). Persistence is atomic and never throws — a write error degrades
 * the check to `warn` instead of aborting the run.
 * @param targetPath - Project path to assess and persist under
 * @returns Doctor check result
 */
export async function checkRepositoryReadiness(
  targetPath: string
): Promise<DoctorCheck> {
  const dimensions = await buildReadinessDimensions(targetPath);
  const { verdict, blockers, narrowed_claim } = assessReadiness(dimensions);
  const report: ReadinessReport = {
    schema_version: READINESS_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    lisa_version: resolveLisaVersion(),
    worker_signature: currentWorkerSignature(),
    verdict,
    narrowed_claim,
    blockers,
    blocker_count: blockers.length,
    dimensions,
  };

  const headline = formatReadinessHeadline(verdict, dimensions);
  const blockerPhrase = `${blockers.length} standing ship blocker${blockers.length === 1 ? "" : "s"}`;
  const standingDetail = formatStandingBlockerDetail(blockers, narrowed_claim);

  const reportPath = resolveReadinessReportPath(targetPath);
  try {
    await persistReadinessReport(reportPath, report);
  } catch (error) {
    return {
      name: REPOSITORY_READINESS_CHECK_NAME,
      status: "warn",
      detail:
        // A failed write is precisely when the operator cannot go read the
        // report, so this branch must name the standing blockers too.
        `${headline} (${blockerPhrase}).${standingDetail} ` +
        `Could not persist ${READINESS_REPORT_DISPLAY_PATH}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    name: REPOSITORY_READINESS_CHECK_NAME,
    status: verdict === "READY" ? "ok" : "warn",
    detail:
      `${headline} (${blockerPhrase}; see readiness-rubric).${standingDetail} ` +
      `Report written to ${READINESS_REPORT_DISPLAY_PATH} (schema_version ${READINESS_SCHEMA_VERSION}).`,
  };
}

/**
 * Name each standing blocker and state the narrowed claim in the operator-facing
 * detail line. A bare `NOT_READY` is unactionable at the gate: the reader is
 * non-technical (`factory-model`), so they must be told which blocker stands and
 * — the rubric's net-new requirement — what the repository IS still ready for.
 * Returns an empty string when nothing stands, leaving the clean line untouched.
 * @param blockers - Standing ship blockers
 * @param narrowedClaim - The computed narrowed claim, or null
 * @returns A leading-space detail fragment, or `""`
 */
function formatStandingBlockerDetail(
  blockers: readonly DetectedBlocker[],
  narrowedClaim: string | null
): string {
  if (blockers.length === 0) {
    return "";
  }
  const named = blockers
    .map(blocker => `${blocker.id} — ${blocker.label}`)
    .join("; ");
  return ` Standing: ${named}.${narrowedClaim ? ` ${narrowedClaim}` : ""}`;
}

/**
 * Write the operator-facing headline for a readiness run, conclusion first.
 *
 * The reader at the gate is non-technical (`factory-model`), so the sentence
 * leads with what it means rather than burying it after the mechanics. When any
 * dimension was never assessed the headline says the readiness question is NOT
 * ESTABLISHED and states how much was skipped — silence is reported as silence,
 * never as health (#1897). Once every dimension has been assessed the
 * not-established caveat is dropped entirely, because a fully assessed run must
 * not carry a sentence contradicting its own verdict. The doctor renderer
 * already prefixes the check name, so this text does not repeat it.
 * @param verdict - The computed verdict for this run
 * @param dimensions - The per-dimension records for this run
 * @returns One operator-language clause, conclusion first, with no trailing period
 */
export function formatReadinessHeadline(
  verdict: ReadinessVerdict,
  dimensions: readonly ReadinessDimensionInput[]
): string {
  const unassessed = dimensions.filter(
    dimension => dimension.status === "SKIP"
  ).length;
  if (unassessed === 0) {
    return (
      `${verdict} — every dimension was assessed ` +
      `across ${dimensions.length} ownership dimensions`
    );
  }
  return (
    `NOT ESTABLISHED (${verdict}) — ${unassessed} of ${dimensions.length} ` +
    `dimensions ${unassessed === 1 ? "was" : "were"} never assessed, so this ` +
    `cannot say whether an unattended fleet may operate here`
  );
}

/**
 * Build the eight readiness dimensions in fixed render order by dispatching each
 * to its producer. Execution/proof and proportionality are wired to #1742's
 * shared journey runner (RRR-6, #1858); delivery/authority is wired to the
 * offline workflow producers assessing ship blockers B2 and B3 (#1896). A
 * dimension with no producer yet falls through to a stated-reason SKIP rather
 * than a blank one (#1898), so the report never presents "never looked" as
 * "nothing to report".
 * @param targetPath - Project path to assess
 * @returns The eight per-dimension records, in fixed order
 */
async function buildReadinessDimensions(
  targetPath: string
): Promise<readonly ReadinessDimensionRecord[]> {
  return Promise.all(
    READINESS_DIMENSIONS.map(
      async (dimension): Promise<ReadinessDimensionRecord> => {
        const produce = DIMENSION_PRODUCERS[dimension.id];
        return produce
          ? await runDimensionProducer(dimension.id, targetPath, produce)
          : reasonedSkip(
              dimension.skipReason ??
                `No readiness probe is wired for the ${dimension.id} dimension ` +
                  "in this Lisa version, so it was not assessed.",
              dimension.id
            );
      }
    )
  );
}

/**
 * Run one dimension's producer behind an error boundary. A producer that throws
 * degrades its own dimension to a stated-reason SKIP instead of aborting the
 * whole readiness check — losing one dimension is recoverable, losing the report
 * is not, and the operator is told which dimension failed and why.
 * @param id - The dimension id
 * @param targetPath - Project path to assess
 * @param produce - The dimension's producer
 * @returns The produced record, or a stated-reason SKIP on failure
 */
export async function runDimensionProducer(
  id: string,
  targetPath: string,
  produce: DimensionProducer
): Promise<ReadinessDimensionRecord> {
  try {
    return await produce(targetPath);
  } catch (error) {
    return reasonedSkip(
      `The ${id} readiness probe could not complete, so this dimension was not ` +
        `assessed: ${error instanceof Error ? error.message : String(error)}`,
      id
    );
  }
}

/**
 * Produce one dimension's record from the project path. Every producer is
 * offline by construction — readiness must be assessable with no network.
 */
export type DimensionProducer = (
  targetPath: string
) => Promise<ReadinessDimensionRecord>;

/**
 * The producer for each wired dimension, keyed by dimension id. Adding a
 * dimension's evidence surface is one entry here; a dimension absent from this
 * map falls through to {@link reasonedSkip} rather than to silence.
 */
const DIMENSION_PRODUCERS: Readonly<Record<string, DimensionProducer>> = {
  [EXECUTION_PROOF_DIMENSION_ID]: async targetPath =>
    await assessExecutionProofDimension(targetPath),
  [PROPORTIONALITY_DIMENSION_ID]: async targetPath =>
    await assessProportionalityDimension(targetPath),
  [DELIVERY_AUTHORITY_DIMENSION_ID]: async targetPath =>
    await assessDeliveryAuthorityDimension(targetPath),
};

/**
 * Build the stated-reason SKIP a dimension without a wired producer renders
 * (#1898). A blank SKIP reads as "nothing to report" when it actually means
 * "never looked", so the reason the rubric already carries is surfaced into the
 * record instead of being dropped. It names no `blocker`, so it can never stand
 * one up.
 * @param reason - Operator-language reason the dimension was not assessed
 * @param id - The dimension id
 * @returns The SKIP dimension record
 */
function reasonedSkip(reason: string, id: string): ReadinessDimensionRecord {
  return { id, status: "SKIP", findings: [{ reason, skip: true }] };
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
