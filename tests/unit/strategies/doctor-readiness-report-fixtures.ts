/**
 * Shared `.lisa/readiness.json` fixtures for the agent-facing readiness bridge
 * (#1902).
 *
 * Two suites drive the bridge — the projection/degrade contract and the
 * standing-blocker contract — and both need a report in the CLI's exact
 * persisted shape. Building that shape once here is what keeps the two suites
 * from drifting into two different ideas of what the CLI writes, which is the
 * same class of divergence #1902 exists to close.
 * @module tests/unit/strategies/doctor-readiness-report-fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Dimension owning the delivery/authority blockers (B2, B3). */
export const DELIVERY_AUTHORITY = "delivery-authority";

/** Dimension owning B6, recorded `WARN` by its producer while B6 stands. */
export const CONTEXT_ROUTING = "context-routing";

/** Dimension the scaffolding-subtraction findings land on. */
export const PROPORTIONALITY = "proportionality";

/** Dimension whose producer evidences B4. */
export const FEEDBACK_GUARDRAILS = "feedback-guardrails";

/** Dimension that co-owns B4 in the spec but never evidences it. */
export const DOMAIN_OWNERSHIP = "domain-ownership";

/** The eight ownership dimensions, in fixed render order (readiness-rubric). */
export const DIMENSION_IDS = [
  CONTEXT_ROUTING,
  "capabilities-tools",
  DOMAIN_OWNERSHIP,
  "execution-proof",
  FEEDBACK_GUARDRAILS,
  "dependencies-supply-chain",
  DELIVERY_AUTHORITY,
  PROPORTIONALITY,
] as const;

/** `generated_at` stamped into every fixture report. */
export const FIXTURE_GENERATED_AT = "2026-07-21T00:00:00.000Z";

/** `lisa_version` stamped into every fixture report. */
export const FIXTURE_LISA_VERSION = "2.281.0";

/** A per-dimension record in the CLI's persisted shape. */
export interface FixtureDimension {
  readonly id: string;
  readonly status: string;
  readonly findings: readonly unknown[];
}

/** All eight dimensions recorded clean, the clean-repository baseline. */
export const passingDimensions: readonly FixtureDimension[] = DIMENSION_IDS.map(
  id => ({
    id,
    status: "PASS",
    findings: [{ evidence: `dimension ${id} assessed clean`, checked: [] }],
  })
);

/**
 * Serialize a readiness report in the CLI's persisted shape (schema_version 1).
 * @param root0 - Fixture inputs
 * @param root0.dimensions - Per-dimension records to persist
 * @param root0.verdict - Report-level verdict
 * @param root0.blockers - Detected blockers to persist, defaulting to none
 * @param root0.narrowedClaim - The supervised-work fallback sentence, if any
 * @returns The report serialized as JSON
 */
export const readinessReport = ({
  dimensions,
  verdict,
  blockers = [],
  narrowedClaim = null,
}: {
  dimensions: readonly FixtureDimension[];
  verdict: string;
  blockers?: readonly Record<string, unknown>[];
  narrowedClaim?: string | null;
}): string =>
  JSON.stringify({
    schema_version: 1,
    generated_at: FIXTURE_GENERATED_AT,
    lisa_version: FIXTURE_LISA_VERSION,
    worker_signature: "claude/unknown/unknown",
    verdict,
    narrowed_claim: narrowedClaim,
    blockers,
    blocker_count: blockers.length,
    dimensions,
  });

/**
 * Write a readiness report under a scratch project root.
 * @param root - Scratch project root to write the report under
 * @param contents - Raw file contents, so malformed fixtures stay expressible
 */
export const writeReadinessReport = (root: string, contents: string): void => {
  mkdirSync(path.join(root, ".lisa"), { recursive: true });
  writeFileSync(path.join(root, ".lisa", "readiness.json"), contents, "utf8");
};

/**
 * Replace one dimension's record, leaving the other seven clean.
 * @param id - Dimension id to override
 * @param overrides - Fields to apply to that dimension's record
 * @returns All eight dimensions with the override applied
 */
export const withDimension = (
  id: string,
  overrides: Partial<FixtureDimension>
): readonly FixtureDimension[] =>
  passingDimensions.map(dimension =>
    dimension.id === id ? { ...dimension, ...overrides } : dimension
  );
