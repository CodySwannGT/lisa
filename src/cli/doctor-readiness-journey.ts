/**
 * Readiness journey-evidence wiring (RRR-6, #1858).
 *
 * The execution/proof readiness dimension may not *assume* end-to-end
 * operability — the PRD requires it to be backed by at least one representative
 * journey executed by the configured worker. #1742 already ships that journey
 * machinery inside `lisa doctor`; this module connects it to the readiness
 * verdict without building a second harness (intake decision F5). It consumes
 * the shared runner in `doctor-worker-journey.ts`, applies a freshness contract
 * (same worker signature, evidence newer than the current artifact head), and:
 *
 * - reuses fresh qualification evidence, running no journey;
 * - triggers a `lisa-use-the-product` journey when evidence is absent or stale,
 *   respecting the per-environment mutation policy from `.lisa.config.json`
 *   (a `forbidden` policy renders `SKIP` naming the policy — readiness never
 *   overrides it);
 * - reports the claim as *not established* (a stated-reason `SKIP`, never a
 *   guessed pass) when a journey cannot be run;
 * - files a build-ready ticket through the existing #1742 path and stands up
 *   blocker 7 when a journey fails, expressed in PRD #1738's claim→evidence
 *   shape so there is one evidence definition across both PRDs.
 *
 * It also surfaces #1742's scaffolding-subtraction candidate count into the
 * proportionality dimension's `machinery_to_remove` field — surfaced, never
 * auto-deleted. Warn-only per intake decision O1: nothing here hard-blocks.
 * @module cli/doctor-readiness-journey
 */
import {
  isQualificationEvidenceFresh,
  type MutationPolicy,
  resolveMutationPolicy,
  resolveMutationPolicyForPath,
} from "./doctor-readiness-journey-freshness.js";
import {
  resolveWorkerJourneyEvidence,
  type RuntimeWorkerSignature,
  type WorkerJourneyEvidence,
} from "./doctor-worker-journey.js";

// Re-export the mutation-policy resolver so `.lisa/readiness.json` readers and
// tests keep one import path even though the gate lives in a sibling module for
// file-size hygiene.
export { resolveMutationPolicy, type MutationPolicy };

/** The execution/proof readiness dimension id (readiness-rubric, RRR-1). */
export const EXECUTION_PROOF_DIMENSION_ID = "execution-proof";

/** The proportionality readiness dimension id (readiness-rubric, RRR-1). */
export const PROPORTIONALITY_DIMENSION_ID = "proportionality";

/**
 * The claim id and boundary blocker 7 binds to, named once so the execution
 * proof evidence uses one vocabulary across every branch.
 */
const OPERABILITY_CLAIM_ID = "end-to-end-operability";
const OPERABILITY_BOUNDARY = "configured-worker-representative-journey";
const PROVABILITY_BLOCKER_ID = "B7";

/** Per-dimension status, mirroring the shared doctor readiness statuses. */
type ReadinessStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

/** A per-dimension record the readiness collector persists. */
export interface JourneyDimensionRecord {
  readonly id: string;
  readonly status: ReadinessStatus;
  readonly findings: readonly unknown[];
}

/** The outcome of running a representative journey. */
export type JourneyOutcome =
  | { readonly result: "passed"; readonly evidence: string }
  | {
      readonly result: "failed";
      readonly evidence: string;
      readonly failureDetail?: string;
    };

/** Context handed to a representative-journey runner. */
export interface JourneyRunContext {
  readonly targetPath: string;
  readonly signature: RuntimeWorkerSignature;
  readonly mutationPolicy: MutationPolicy;
}

/** Runs one representative journey through `lisa-use-the-product`. */
export type JourneyRunner = (
  context: JourneyRunContext
) => Promise<JourneyOutcome>;

/** The build-ready ticket a failing journey files through the #1742 path. */
export interface JourneyTicketRequest {
  readonly summary: string;
  readonly detail: string;
  readonly signature: RuntimeWorkerSignature;
}

/** Files a build-ready ticket and returns its reference. */
export type JourneyTicketFiler = (
  request: JourneyTicketRequest
) => Promise<string>;

/** Options for {@link assessExecutionProofDimension}. */
export interface ExecutionProofOptions {
  /** Injected "now"; defaults to the current time. */
  readonly now?: Date;
  /**
   * Injected artifact-head timestamp for the freshness comparison. When omitted,
   * it is resolved from the git HEAD commit time; when that cannot be resolved,
   * freshness falls back to "no drift and evidence present".
   */
  readonly artifactHead?: Date | null;
  /**
   * The representative-journey runner. Omitted means the journey cannot be run
   * in this context (headless/no worker) — the claim is reported as *not
   * established* rather than assumed.
   */
  readonly runJourney?: JourneyRunner;
  /** Files a build-ready ticket on a failing journey (default: no-op recorder). */
  readonly fileTicket?: JourneyTicketFiler;
  /** Overrides the resolved mutation policy (default: read `.lisa.config.json`). */
  readonly mutationPolicy?: MutationPolicy;
}

/** Options for {@link assessProportionalityDimension}. */
export interface ProportionalityOptions {
  /** Overrides the resolved subtraction-candidate count (default: scan the repo). */
  readonly subtractionCount?: number;
}

/**
 * Assess the execution/proof dimension by reusing #1742's journey machinery.
 * @param targetPath - Project path to assess
 * @param options - Injected collaborators and freshness inputs
 * @returns The execution/proof dimension record
 */
export async function assessExecutionProofDimension(
  targetPath: string,
  options: ExecutionProofOptions = {}
): Promise<JourneyDimensionRecord> {
  const policy =
    options.mutationPolicy ?? (await resolveMutationPolicyForPath(targetPath));
  if (policy === "forbidden") {
    return skipDimension(
      `mutation policy '${policy}' forbids exercising this environment; the ` +
        "representative journey was not run and end-to-end operability is not asserted",
      { policy }
    );
  }

  const evidence = await resolveWorkerJourneyEvidence(targetPath);
  if (
    await isQualificationEvidenceFresh(
      evidence,
      targetPath,
      options.artifactHead
    )
  ) {
    return reuseFreshEvidence(evidence);
  }
  return runRepresentativeJourney(targetPath, evidence, options);
}

/**
 * Assess the proportionality dimension: surface #1742's scaffolding-subtraction
 * candidate count into `machinery_to_remove`. Surfaced, never auto-deleted
 * (intake decision, RRR-6 technical approach point 6); it is never a blocker.
 * @param targetPath - Project path to scan
 * @param options - Injected subtraction count
 * @returns The proportionality dimension record
 */
export async function assessProportionalityDimension(
  targetPath: string,
  options: ProportionalityOptions = {}
): Promise<JourneyDimensionRecord> {
  const count =
    options.subtractionCount ??
    (await resolveWorkerJourneyEvidence(targetPath)).subtractionCount;
  if (count <= 0) {
    return { id: PROPORTIONALITY_DIMENSION_ID, status: "SKIP", findings: [] };
  }
  return {
    id: PROPORTIONALITY_DIMENSION_ID,
    status: "SKIP",
    findings: [
      {
        machinery_to_remove: [
          `${count} worker-specific scaffolding-subtraction candidate` +
            `${count === 1 ? "" : "s"} surfaced by the worker-epoch runner (#1742)`,
        ],
        evidence:
          `Scaffolding-subtraction candidates surfaced: ${count}. Surfaced for ` +
          "operator review only — nothing is auto-deleted.",
        auto_deleted: false,
      },
    ],
  };
}

/**
 * Build the reuse branch: fresh evidence establishes the claim, no journey runs.
 * @param evidence - Resolved worker journey evidence
 * @returns The execution/proof dimension record
 */
function reuseFreshEvidence(
  evidence: WorkerJourneyEvidence
): JourneyDimensionRecord {
  return {
    id: EXECUTION_PROOF_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        blocker: PROVABILITY_BLOCKER_ID,
        evidence:
          `Reused fresh qualification evidence for ${evidence.signature.host}: ` +
          `${evidence.evidence} (recorded in .lisa/worker-config.json). No new ` +
          "journey executed.",
        claim_evidence: establishedClaim(),
        worker_config_ref: ".lisa/worker-config.json",
        reused: true,
      },
    ],
  };
}

/**
 * Build the journey-run branch: run the representative journey (or report the
 * claim as not established when it cannot run), and record the result in PRD
 * #1738's claim→evidence shape.
 * @param targetPath - Project path (unused beyond context assembly)
 * @param evidence - Resolved worker journey evidence
 * @param options - Injected runner and ticket filer
 * @returns The execution/proof dimension record
 */
async function runRepresentativeJourney(
  targetPath: string,
  evidence: WorkerJourneyEvidence,
  options: ExecutionProofOptions
): Promise<JourneyDimensionRecord> {
  if (!options.runJourney) {
    return skipDimension(
      "end-to-end operability not established: no representative journey could " +
        "be run (headless/no configured worker) and no fresh qualification " +
        "evidence is on file. lisa-use-the-product must drive a real journey " +
        "before this claim is asserted.",
      { evidence_status: "not-established" }
    );
  }
  const policy =
    options.mutationPolicy ?? (await resolveMutationPolicyForPath(targetPath));
  const outcome = await options.runJourney({
    targetPath,
    signature: evidence.signature,
    mutationPolicy: policy,
  });
  if (outcome.result === "passed") {
    return journeyPassed(evidence, outcome.evidence);
  }
  return journeyFailed(evidence, outcome, options);
}

/**
 * Build the passing-journey branch: the claim is established by a fresh run.
 * @param evidence - Resolved worker journey evidence
 * @param journeyEvidence - The evidence pointer the journey produced
 * @returns The execution/proof dimension record
 */
function journeyPassed(
  evidence: WorkerJourneyEvidence,
  journeyEvidence: string
): JourneyDimensionRecord {
  return {
    id: EXECUTION_PROOF_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        blocker: PROVABILITY_BLOCKER_ID,
        evidence:
          `Representative journey run through lisa-use-the-product by ` +
          `${evidence.signature.host}: ${journeyEvidence}.`,
        claim_evidence: establishedClaim(),
        worker_config_ref: ".lisa/worker-config.json",
        reused: false,
      },
    ],
  };
}

/**
 * Build the failing-journey branch: file a build-ready ticket through the #1742
 * path and stand up blocker 7 via PRD #1738's evidence shape.
 * @param evidence - Resolved worker journey evidence
 * @param outcome - The failing journey outcome
 * @param options - Injected ticket filer
 * @returns The execution/proof dimension record
 */
async function journeyFailed(
  evidence: WorkerJourneyEvidence,
  outcome: Extract<JourneyOutcome, { result: "failed" }>,
  options: ExecutionProofOptions
): Promise<JourneyDimensionRecord> {
  const detail =
    outcome.failureDetail ?? "the representative journey did not pass";
  const summary = `Representative journey failed for ${evidence.signature.host}: ${detail}`;
  const fileTicket = options.fileTicket ?? (async () => "");
  const ticketRef = await fileTicket({
    summary,
    detail: `${summary}. Journey evidence: ${outcome.evidence}.`,
    signature: evidence.signature,
  });
  const ticketSuffix = ticketRef
    ? ` Build-ready ticket filed: ${ticketRef}.`
    : "";
  return {
    id: EXECUTION_PROOF_DIMENSION_ID,
    status: "FAIL",
    findings: [
      {
        blocker: PROVABILITY_BLOCKER_ID,
        invariant_violated:
          "end-to-end operability must be proven by a passing representative journey",
        evidence: `${summary}. Journey evidence: ${outcome.evidence}.${ticketSuffix}`,
        why_proof_missed:
          "the representative journey executed by the configured worker failed",
        claim_evidence: {
          claim_id: OPERABILITY_CLAIM_ID,
          boundary: OPERABILITY_BOUNDARY,
          required_evidence_kinds: ["representative-journey"],
          not_established: [OPERABILITY_BOUNDARY],
        },
        ticket_ref: ticketRef,
      },
    ],
  };
}

/**
 * The established-claim shape (blocker 7 CLEAR): a bound claim whose
 * `not_established` list is empty, reviewed.
 * @returns PRD #1738 claim→evidence establishing the operability claim
 */
function establishedClaim(): Record<string, unknown> {
  return {
    claim_id: OPERABILITY_CLAIM_ID,
    boundary: OPERABILITY_BOUNDARY,
    required_evidence_kinds: ["representative-journey"],
    not_established: [],
    not_established_reviewed: true,
  };
}

/**
 * Build a stated-reason SKIP dimension record — the honest degrade that reports
 * a claim as not established rather than guessing it. Carries no `blocker`
 * field, so it never stands up a ship blocker.
 * @param reason - Operator-language reason for the SKIP
 * @param extra - Extra fields to attach to the finding
 * @returns The execution/proof dimension record
 */
function skipDimension(
  reason: string,
  extra: Record<string, unknown> = {}
): JourneyDimensionRecord {
  return {
    id: EXECUTION_PROOF_DIMENSION_ID,
    status: "SKIP",
    findings: [{ reason, skip: true, ...extra }],
  };
}
