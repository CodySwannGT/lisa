/**
 * The seven-blocker gate and narrowed claim for repository readiness (RRR-5,
 * #1857).
 *
 * RRR-3 (#1855) produces the eight readiness dimensions and persists the report;
 * this module turns their findings into the thing that decides what the
 * repository may be *claimed* to be. It is a pure mapping from dimension
 * findings to the closed set of seven ship blockers (B1..B7 per the
 * `readiness-rubric` rule, RRR-1 #1853), a verdict flip to `NOT_READY` when any
 * blocker stands, and the required operator-language narrowed claim. Blocker 7
 * ("no way to prove the claimed user-visible outcome") is expressed in PRD
 * #1738's claim→evidence shape (`claim-evidence-mapping`) so there is exactly
 * one definition of what establishes a claim across both PRDs.
 *
 * It gates a *claim*, not a *process*: per intake decision O1 nothing here
 * hard-blocks. The verdict ladder is the shipped one — no new enum (F2). The
 * blocker set is closed in v1 and extended only by editing this module and the
 * rule (intake decision O4).
 * @module cli/doctor-readiness-blockers
 */

/** Verdict ladder reused from the shipped doctor surface (readiness-rubric). */
export type ReadinessVerdict = "READY" | "READY_WITH_WARNINGS" | "NOT_READY";

/** Dimension ids owned by one or more blockers (readiness-rubric table). */
const DIMENSION_CONTEXT_ROUTING = "context-routing";
const DIMENSION_DOMAIN_OWNERSHIP = "domain-ownership";
const DIMENSION_EXECUTION_PROOF = "execution-proof";
const DIMENSION_FEEDBACK_GUARDRAILS = "feedback-guardrails";
const DIMENSION_DEPENDENCIES_SUPPLY_CHAIN = "dependencies-supply-chain";
const DIMENSION_DELIVERY_AUTHORITY = "delivery-authority";

/**
 * The closed v1 set of seven ship blockers (readiness-rubric, RRR-1 #1853).
 * Extending it is a deliberate rule edit, never a configuration surface (intake
 * decision O4). A standing blocker makes the claim "an unattended fleet may run
 * here" false and flips the verdict to `NOT_READY`.
 */
export const SHIP_BLOCKER_IDS = [
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
] as const;

/** One of the seven closed-set ship blocker ids. */
export type ShipBlockerId = (typeof SHIP_BLOCKER_IDS)[number];

/** The blocker-7 id, named once so the provability path stays legible. */
const PROVABILITY_BLOCKER_ID: ShipBlockerId = "B7";

/**
 * The reason blocker 7 renders `SKIP` when PRD #1738's claim→evidence contract
 * is unavailable — a stated reason, never a guessed provability verdict
 * (RRR-5 technical approach point 4).
 */
export const CLAIM_EVIDENCE_UNAVAILABLE_REASON =
  "claim-evidence contract not yet available";

/** Static blocker metadata: operator-language label + owning dimension ids. */
interface ShipBlockerSpec {
  readonly label: string;
  readonly owning_dimensions: readonly string[];
}

/**
 * Blocker → owning-dimension mapping, cited verbatim from the `readiness-rubric`
 * seven-blocker table (RRR-1). This module consumes that table; it does not
 * redefine the vocabulary.
 */
const SHIP_BLOCKERS: Record<ShipBlockerId, ShipBlockerSpec> = {
  B1: {
    label: "A realistic path causes silent data loss",
    owning_dimensions: [DIMENSION_DOMAIN_OWNERSHIP],
  },
  B2: {
    label: "A release path bypasses the validated artifact",
    owning_dimensions: [DIMENSION_DELIVERY_AUTHORITY],
  },
  B3: {
    label: "Credentials carry material unintended authority",
    owning_dimensions: [DIMENSION_DELIVERY_AUTHORITY],
  },
  B4: {
    label: "A consequential operation has no gate and no recovery",
    owning_dimensions: [
      DIMENSION_DOMAIN_OWNERSHIP,
      DIMENSION_FEEDBACK_GUARDRAILS,
    ],
  },
  B5: {
    label: "An owned compatibility or security surface has no confidence model",
    owning_dimensions: [DIMENSION_DEPENDENCIES_SUPPLY_CHAIN],
  },
  B6: {
    label: "Documentation overstates enforced guarantees",
    owning_dimensions: [DIMENSION_CONTEXT_ROUTING],
  },
  B7: {
    label: "There is no way to prove the claimed user-visible outcome",
    owning_dimensions: [DIMENSION_EXECUTION_PROOF],
  },
};

/**
 * PRD #1738's claim→evidence shape (`claim-evidence-mapping`), consumed — never
 * redefined — by blocker 7. A claim binds to one boundary and is established
 * only by evidence of a kind that reaches it; a non-empty `not_established`
 * means the user-visible outcome is not provable.
 */
interface ClaimEvidence {
  readonly claim_id?: string;
  readonly boundary?: string;
  readonly required_evidence_kinds?: readonly string[];
  readonly not_established?: readonly string[];
  readonly not_established_reviewed?: boolean;
}

/**
 * A finding attached to a readiness dimension. Loosely typed because findings
 * arrive from the persisted `.lisa/readiness.json` (or a fixture) as JSON. A
 * finding evidences a blocker only when it names one and carries evidence.
 */
interface ReadinessFinding {
  readonly blocker?: string;
  readonly severity?: string;
  readonly blocking?: boolean;
  readonly invariant_violated?: string;
  readonly evidence?: string;
  readonly claim_evidence?: ClaimEvidence;
  readonly why_proof_missed?: string;
  readonly root_correction?: string;
  readonly machinery_to_remove?: readonly string[];
}

/** The minimal dimension shape blocker detection reads (record or fixture). */
export interface ReadinessDimensionInput {
  readonly id: string;
  readonly status: string;
  readonly findings: readonly unknown[];
}

/**
 * A standing ship blocker plus the finding that evidences it. A blocker is
 * never emitted without an evidencing finding — the same discipline
 * `convergent-review` applies to blocking findings without a failure scenario.
 */
export interface DetectedBlocker {
  readonly id: ShipBlockerId;
  readonly label: string;
  readonly owning_dimensions: readonly string[];
  readonly dimension_id: string;
  readonly invariant_violated: string;
  readonly evidence: string;
  readonly claim_evidence?: ClaimEvidence;
}

/** Options shared by the blocker-detection surfaces. */
export interface BlockerDetectionOptions {
  /**
   * Whether PRD #1738's claim→evidence contract is available. When `false`,
   * blocker 7 degrades to `SKIP` with a stated reason instead of guessing.
   * Defaults to `true` — #1738 has landed.
   */
  readonly claimEvidenceContractAvailable?: boolean;
}

/** The provability (blocker 7) sub-assessment for the execution/proof dimension. */
export interface ProvabilityAssessment {
  readonly status: "STANDS" | "CLEAR" | "SKIP";
  readonly reason?: string;
  readonly finding?: ReadinessFinding;
}

/** The blocker-gate assessment `checkRepositoryReadiness` persists. */
export interface ReadinessAssessment {
  readonly verdict: ReadinessVerdict;
  readonly blockers: readonly DetectedBlocker[];
  readonly narrowed_claim: string | null;
}

/**
 * Gate the unattended-operation claim on the seven ship blockers and, when any
 * stands, emit the narrowed claim. This is RRR-5's pure core: it consumes the
 * dimension findings, maps them to blockers (blocker 7 via PRD #1738's evidence
 * shape), flips the verdict to `NOT_READY` when a blocker stands, and produces
 * the operator-language narrowed claim. It gates a *claim*, not a *process* —
 * intake decision O1 keeps every Lisa surface warn-only.
 * @param dimensions - Per-dimension records (from the report or a fixture)
 * @param options - Blocker-detection options (claim→evidence availability)
 * @returns The verdict, standing blockers, and narrowed claim
 */
export function assessReadiness(
  dimensions: readonly ReadinessDimensionInput[],
  options: BlockerDetectionOptions = {}
): ReadinessAssessment {
  const blockers = detectShipBlockers(dimensions, options);
  return {
    verdict: computeReadinessVerdict(dimensions, blockers),
    blockers,
    narrowed_claim: computeNarrowedClaim(blockers),
  };
}

/**
 * Reduce dimensions and standing blockers to the shipped verdict ladder. A
 * standing ship blocker is the only thing that yields `NOT_READY` (the rubric's
 * definition); otherwise any non-clean dimension is `READY_WITH_WARNINGS`, and
 * an all-clean report is `READY`. No new verdict enum (F2).
 * @param dimensions - Per-dimension records
 * @param blockers - Standing ship blockers
 * @returns Overall verdict
 */
function computeReadinessVerdict(
  dimensions: readonly ReadinessDimensionInput[],
  blockers: readonly DetectedBlocker[]
): ReadinessVerdict {
  if (blockers.length > 0) {
    return "NOT_READY";
  }
  if (
    dimensions.some(
      dimension => dimension.status === "FAIL" || dimension.status === "WARN"
    )
  ) {
    return "READY_WITH_WARNINGS";
  }
  return "READY";
}

/**
 * Coerce an untyped persisted finding into the {@link ReadinessFinding} shape.
 * @param value - A raw finding value from JSON
 * @returns The finding as a typed object, or an empty object when not one
 */
function coerceFinding(value: unknown): ReadinessFinding {
  return typeof value === "object" && value !== null
    ? (value as ReadinessFinding)
    : {};
}

/**
 * Whether a finding carries the evidence a blocker needs to be emitted. A
 * finding that names a blocker but carries no evidence is malformed and must be
 * dropped, never emitted bare.
 * @param finding - The finding to check
 * @returns True when the finding has non-empty evidence text
 */
function hasEvidence(finding: ReadinessFinding): boolean {
  return typeof finding.evidence === "string" && finding.evidence.trim() !== "";
}

/**
 * Locate the first finding across all dimensions that evidences a blocker id.
 * @param dimensions - Per-dimension records
 * @param blockerId - The ship blocker id to evidence
 * @returns The evidencing finding and its dimension id, or undefined
 */
function locateEvidencingFinding(
  dimensions: readonly ReadinessDimensionInput[],
  blockerId: ShipBlockerId
):
  | { readonly dimensionId: string; readonly finding: ReadinessFinding }
  | undefined {
  for (const dimension of dimensions) {
    for (const raw of dimension.findings) {
      const finding = coerceFinding(raw);
      if (finding.blocker === blockerId && hasEvidence(finding)) {
        return { dimensionId: dimension.id, finding };
      }
    }
  }
  return undefined;
}

/**
 * Assess blocker 7 — "no way to prove the claimed user-visible outcome" — from
 * the execution/proof dimension, expressed in PRD #1738's claim→evidence shape.
 * The outcome is unprovable (the blocker STANDS) when a claim's
 * `not_established` list is non-empty; it is CLEAR when that list is empty. If
 * #1738's contract is unavailable, or a blocker-7 finding is not expressed in
 * its shape, the assessment is `SKIP` with a stated reason rather than a guess.
 * @param dimension - The execution/proof dimension record, if present
 * @param options - Blocker-detection options (claim→evidence availability)
 * @returns The provability sub-assessment
 */
export function assessProvabilityBlocker(
  dimension: ReadinessDimensionInput | undefined,
  options: BlockerDetectionOptions = {}
): ProvabilityAssessment {
  if (options.claimEvidenceContractAvailable === false) {
    return { status: "SKIP", reason: CLAIM_EVIDENCE_UNAVAILABLE_REASON };
  }
  const finding = (dimension?.findings ?? [])
    .map(coerceFinding)
    .find(candidate => candidate.blocker === PROVABILITY_BLOCKER_ID);
  if (!finding) {
    return { status: "CLEAR" };
  }
  const claimEvidence = finding.claim_evidence;
  if (!claimEvidence || !Array.isArray(claimEvidence.required_evidence_kinds)) {
    // A blocker-7 finding not expressed in #1738's shape cannot be assessed:
    // degrade to SKIP with a stated reason instead of inventing a stand-in.
    return { status: "SKIP", reason: CLAIM_EVIDENCE_UNAVAILABLE_REASON };
  }
  const notEstablished = Array.isArray(claimEvidence.not_established)
    ? claimEvidence.not_established
    : [];
  return notEstablished.length > 0
    ? { status: "STANDS", finding }
    : { status: "CLEAR" };
}

/**
 * Build a {@link DetectedBlocker} from an evidencing finding, stamping the
 * cited label and owning dimensions from the readiness-rubric table.
 * @param id - The ship blocker id
 * @param dimensionId - The dimension the evidencing finding was found in
 * @param finding - The evidencing finding
 * @returns The detected blocker
 */
function buildDetectedBlocker(
  id: ShipBlockerId,
  dimensionId: string,
  finding: ReadinessFinding
): DetectedBlocker {
  const spec = SHIP_BLOCKERS[id];
  return {
    id,
    label: spec.label,
    owning_dimensions: spec.owning_dimensions,
    dimension_id: dimensionId,
    invariant_violated:
      typeof finding.invariant_violated === "string"
        ? finding.invariant_violated
        : "",
    evidence: typeof finding.evidence === "string" ? finding.evidence : "",
    ...(finding.claim_evidence
      ? { claim_evidence: finding.claim_evidence }
      : {}),
  };
}

/**
 * Resolve the standing blocker (if any) for a single blocker id. Blocker 7
 * routes through {@link assessProvabilityBlocker}; blockers 1-6 stand on the
 * first evidencing finding that names them.
 * @param dimensions - Per-dimension records
 * @param id - The ship blocker id to resolve
 * @param options - Blocker-detection options (claim→evidence availability)
 * @returns A single-element array with the standing blocker, or an empty array
 */
function resolveBlocker(
  dimensions: readonly ReadinessDimensionInput[],
  id: ShipBlockerId,
  options: BlockerDetectionOptions
): readonly DetectedBlocker[] {
  if (id === PROVABILITY_BLOCKER_ID) {
    const provability = assessProvabilityBlocker(
      dimensions.find(dimension => dimension.id === DIMENSION_EXECUTION_PROOF),
      options
    );
    return provability.status === "STANDS" && provability.finding
      ? [
          buildDetectedBlocker(
            id,
            DIMENSION_EXECUTION_PROOF,
            provability.finding
          ),
        ]
      : [];
  }
  const located = locateEvidencingFinding(dimensions, id);
  return located
    ? [buildDetectedBlocker(id, located.dimensionId, located.finding)]
    : [];
}

/**
 * Detect the standing ship blockers from dimension findings — a pure mapping
 * from findings to the closed set B1..B7. Blockers 1-6 stand on an evidencing
 * finding that names them; blocker 7 stands only via {@link assessProvabilityBlocker}
 * over PRD #1738's evidence shape. Emitted in fixed id order for a deterministic
 * report; a blocker with no evidencing finding is absent.
 * @param dimensions - Per-dimension records (from the report or a fixture)
 * @param options - Blocker-detection options (claim→evidence availability)
 * @returns The standing blockers, ordered by id
 */
export function detectShipBlockers(
  dimensions: readonly ReadinessDimensionInput[],
  options: BlockerDetectionOptions = {}
): readonly DetectedBlocker[] {
  return SHIP_BLOCKER_IDS.flatMap(id =>
    resolveBlocker(dimensions, id, options)
  );
}

/**
 * Produce the narrowed claim: the required, operator-language statement of what
 * the repository is NOT ready for AND what it IS ready for whenever a blocker
 * stands. Returns `null` when no blocker stands (a `READY`/`READY_WITH_WARNINGS`
 * report carries no narrowed claim). Governed by the `factory-model` rule —
 * written outward for a non-technical operator at the gate.
 * @param blockers - Standing ship blockers
 * @returns The narrowed claim, or null when nothing stands
 */
export function computeNarrowedClaim(
  blockers: readonly DetectedBlocker[]
): string | null {
  if (blockers.length === 0) {
    return null;
  }
  const list = blockers
    .map(blocker => `${blocker.id} — ${blocker.label}`)
    .join("; ");
  const standing =
    blockers.length === 1
      ? "1 ship blocker stands"
      : `${blockers.length} ship blockers stand`;
  return (
    `This repository is NOT ready for unattended fleet operation because ` +
    `${standing}: ${list}. It IS ready for supervised, single-ticket agent ` +
    `work with a human reviewing and approving each change before it ships.`
  );
}
