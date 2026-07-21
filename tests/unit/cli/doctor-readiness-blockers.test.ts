/**
 * Unit coverage for the seven-blocker gate and narrowed claim (RRR-5, #1857).
 *
 * RRR-3 (#1855) produces the eight readiness dimensions and persists the report
 * with an empty `blockers` array and a null `narrowed_claim`. This suite pins
 * the gate that turns dimension findings into standing ship blockers: the closed
 * B1..B7 set, the pure mapping from an evidencing finding to a blocker (and the
 * malformed-without-evidence drop), blocker 7's consumption of PRD #1738's
 * claim→evidence shape (`claim-evidence-mapping`) with a stated-reason SKIP when
 * that contract is unavailable, the verdict flip to NOT_READY, and the required,
 * operator-language narrowed claim that names both what the repository is NOT
 * ready for and what it IS. Fixtures live under tests/fixtures/doctor/readiness.
 * @module tests/unit/cli/doctor-readiness-blockers
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIM_EVIDENCE_UNAVAILABLE_REASON,
  SHIP_BLOCKER_IDS,
  assessProvabilityBlocker,
  assessReadiness,
  computeNarrowedClaim,
  detectShipBlockers,
} from "../../../src/cli/doctor-readiness-blockers.js";

/** Blocker id and dimension id literals reused across the blocker-gate cases. */
const BLOCKER_B2 = "B2";
const BLOCKER_B5 = "B5";
const BLOCKER_B7 = "B7";
const DIMENSION_DELIVERY_AUTHORITY = "delivery-authority";
const DIMENSION_EXECUTION_PROOF = "execution-proof";
const FIXTURE_B2 = "b2-release-bypasses-artifact";
const FIXTURE_B7_UNPROVABLE = "b7-outcome-unprovable";
const FIXTURE_B7_PROVABLE = "b7-outcome-provable";

/**
 * Resolve the absolute path to a per-blocker readiness fixture.
 * @param name - Fixture basename under tests/fixtures/doctor/readiness
 * @returns Absolute path to the fixture JSON file
 */
function fixturePath(name: string): string {
  return path.join(
    __dirname,
    "..",
    "..",
    "fixtures",
    "doctor",
    "readiness",
    `${name}.json`
  );
}

/**
 * Load a fixture's persisted dimension records.
 * @param name - Fixture basename under tests/fixtures/doctor/readiness
 * @returns The fixture's eight dimension records
 */
async function loadDimensions(name: string): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly findings: readonly unknown[];
  }>
> {
  const raw = await readFile(fixturePath(name), "utf8");
  return (JSON.parse(raw) as { dimensions: never }).dimensions;
}

describe("SHIP_BLOCKER_IDS", () => {
  it("is the closed v1 set of exactly seven blockers B1..B7", () => {
    expect([...SHIP_BLOCKER_IDS]).toEqual([
      "B1",
      BLOCKER_B2,
      "B3",
      "B4",
      BLOCKER_B5,
      "B6",
      BLOCKER_B7,
    ]);
    expect(SHIP_BLOCKER_IDS).not.toContain("B8");
  });
});

describe("detectShipBlockers", () => {
  it("detects a standing blocker from an evidencing finding and records that finding", async () => {
    const dimensions = await loadDimensions(FIXTURE_B2);

    const blockers = detectShipBlockers(dimensions);

    expect(blockers.map(blocker => blocker.id)).toEqual([BLOCKER_B2]);
    const [b2] = blockers;
    expect(b2.dimension_id).toBe(DIMENSION_DELIVERY_AUTHORITY);
    // A detected blocker records the finding that evidences it (never emitted bare).
    expect(typeof b2.evidence).toBe("string");
    expect(b2.evidence.length).toBeGreaterThan(0);
    expect(b2.label.toLowerCase()).toContain("release");
  });

  it.each([
    ["b1-silent-data-loss", "B1", "domain-ownership"],
    [FIXTURE_B2, BLOCKER_B2, DIMENSION_DELIVERY_AUTHORITY],
    ["b3-credential-authority", "B3", DIMENSION_DELIVERY_AUTHORITY],
    ["b4-no-gate-no-recovery", "B4", "feedback-guardrails"],
    ["b5-no-confidence-model", BLOCKER_B5, "dependencies-supply-chain"],
    ["b6-docs-overstate-guarantees", "B6", "context-routing"],
    [FIXTURE_B7_UNPROVABLE, BLOCKER_B7, DIMENSION_EXECUTION_PROOF],
  ])(
    "maps fixture %s to standing blocker %s in dimension %s",
    async (fixture, blockerId, dimensionId) => {
      const dimensions = await loadDimensions(fixture);

      const blockers = detectShipBlockers(dimensions);

      expect(blockers.map(blocker => blocker.id)).toContain(blockerId);
      const detected = blockers.find(blocker => blocker.id === blockerId);
      expect(detected?.dimension_id).toBe(dimensionId);
    }
  );

  it("never emits a blocker whose finding carries no evidence (malformed is dropped)", async () => {
    const dimensions = await loadDimensions(
      "malformed-blocker-without-evidence"
    );

    const blockers = detectShipBlockers(dimensions);

    expect(blockers.map(blocker => blocker.id)).not.toContain(BLOCKER_B5);
    expect(blockers).toHaveLength(0);
  });

  it("omits a blocker whose owning dimension has no evidencing finding", async () => {
    // The clean B7-provable fixture has no B5 finding anywhere.
    const dimensions = await loadDimensions(FIXTURE_B7_PROVABLE);

    const blockers = detectShipBlockers(dimensions);

    expect(blockers.map(blocker => blocker.id)).not.toContain(BLOCKER_B5);
  });

  it("detects multiple standing blockers, ordered deterministically by id", async () => {
    const dimensions = await loadDimensions("two-blockers-b2-b7");

    const blockers = detectShipBlockers(dimensions);

    expect(blockers.map(blocker => blocker.id)).toEqual([
      BLOCKER_B2,
      BLOCKER_B7,
    ]);
  });
});

describe("assessProvabilityBlocker (B7 consumes #1738's evidence shape)", () => {
  it("stands when the user-visible claim has a non-empty not_established list", async () => {
    const dimensions = await loadDimensions(FIXTURE_B7_UNPROVABLE);
    const executionProof = dimensions.find(
      dimension => dimension.id === DIMENSION_EXECUTION_PROOF
    );

    const result = assessProvabilityBlocker(executionProof);

    expect(result.status).toBe("STANDS");
    expect(result.finding).toBeDefined();
  });

  it("is clear when the bounded claim's not_established list is empty", async () => {
    const dimensions = await loadDimensions(FIXTURE_B7_PROVABLE);
    const executionProof = dimensions.find(
      dimension => dimension.id === DIMENSION_EXECUTION_PROOF
    );

    const result = assessProvabilityBlocker(executionProof);

    expect(result.status).toBe("CLEAR");
  });

  it("renders SKIP with a stated reason when the #1738 contract is unavailable", async () => {
    const dimensions = await loadDimensions(FIXTURE_B7_UNPROVABLE);
    const executionProof = dimensions.find(
      dimension => dimension.id === DIMENSION_EXECUTION_PROOF
    );

    const result = assessProvabilityBlocker(executionProof, {
      claimEvidenceContractAvailable: false,
    });

    expect(result.status).toBe("SKIP");
    expect(result.reason).toBe(CLAIM_EVIDENCE_UNAVAILABLE_REASON);
  });
});

describe("assessReadiness (blocker gate + narrowed claim)", () => {
  it("flips the verdict to NOT_READY and requires a narrowed claim for a standing blocker", async () => {
    const dimensions = await loadDimensions(FIXTURE_B2);

    const assessment = assessReadiness(dimensions);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers.map(blocker => blocker.id)).toEqual([
      BLOCKER_B2,
    ]);
    // Narrowed claim is required, non-null, and names BOTH sides.
    expect(typeof assessment.narrowed_claim).toBe("string");
    expect(assessment.narrowed_claim).not.toBeNull();
    const claim = (assessment.narrowed_claim ?? "").toLowerCase();
    expect(claim).toContain("not ready");
    expect(claim).toMatch(/is ready|ready for/);
  });

  it("names the standing blocker in the narrowed claim", async () => {
    const dimensions = await loadDimensions(FIXTURE_B2);

    const assessment = assessReadiness(dimensions);

    expect(assessment.narrowed_claim).toContain(BLOCKER_B2);
  });

  it("stays READY with a null narrowed claim when no blocker stands", async () => {
    const dimensions = await loadDimensions(FIXTURE_B7_PROVABLE);

    const assessment = assessReadiness(dimensions);

    expect(assessment.blockers).toHaveLength(0);
    expect(assessment.verdict).not.toBe("NOT_READY");
    expect(assessment.narrowed_claim).toBeNull();
  });

  it("never claims READY when every dimension is unassessed (SKIP)", async () => {
    // #1897: an all-SKIP assessment is zero evidence, not a clean bill of
    // health. It must top out at READY_WITH_WARNINGS, never fall through to
    // READY, or doctor emits a green unattended-fleet claim backed by nothing.
    const dimensions = await loadDimensions("all-skip-unassessed");

    const assessment = assessReadiness(dimensions);

    expect(assessment.blockers).toHaveLength(0);
    expect(assessment.verdict).toBe("READY_WITH_WARNINGS");
  });

  it("still reaches READY when every dimension is assessed PASS", async () => {
    const dimensions = await loadDimensions("all-pass-assessed");

    const assessment = assessReadiness(dimensions);

    expect(assessment.blockers).toHaveLength(0);
    expect(assessment.verdict).toBe("READY");
    expect(assessment.narrowed_claim).toBeNull();
  });

  it("degrades B7 to a non-standing skip when the #1738 contract is unavailable", async () => {
    const dimensions = await loadDimensions(FIXTURE_B7_UNPROVABLE);

    const assessment = assessReadiness(dimensions, {
      claimEvidenceContractAvailable: false,
    });

    expect(assessment.blockers.map(blocker => blocker.id)).not.toContain(
      BLOCKER_B7
    );
  });
});

/** Shared single-blocker fixture reused across computeNarrowedClaim cases. */
const SINGLE_STANDING_BLOCKER = {
  id: "B2",
  label: "A release path bypasses the validated artifact",
  owning_dimensions: [DIMENSION_DELIVERY_AUTHORITY],
  dimension_id: DIMENSION_DELIVERY_AUTHORITY,
  invariant_violated: "What ships equals what CI validated.",
  evidence: "The deploy job rebuilds from source at deploy time.",
};

describe("computeNarrowedClaim", () => {
  it("returns null when there are no standing blockers", () => {
    expect(computeNarrowedClaim([])).toBeNull();
  });

  it("names both what the repository is NOT ready for and what it IS ready for", () => {
    const claim = computeNarrowedClaim([SINGLE_STANDING_BLOCKER]) ?? "";

    expect(claim.toLowerCase()).toContain("not ready");
    expect(claim.toLowerCase()).toMatch(/is ready|ready for/);
    expect(claim).toContain(BLOCKER_B2);
  });

  it("uses singular verb agreement for exactly one standing blocker", () => {
    const claim = computeNarrowedClaim([SINGLE_STANDING_BLOCKER]) ?? "";

    expect(claim).toContain("1 ship blocker stands:");
    expect(claim).not.toContain("1 ship blocker stand:");
  });

  it("uses plural verb agreement for multiple standing blockers", () => {
    const claim =
      computeNarrowedClaim([
        SINGLE_STANDING_BLOCKER,
        {
          id: "B5",
          label: "A monitoring gap goes unaddressed",
          owning_dimensions: [DIMENSION_DELIVERY_AUTHORITY],
          dimension_id: DIMENSION_DELIVERY_AUTHORITY,
          invariant_violated: "Regressions are observable.",
          evidence: "No alerting is wired up.",
        },
      ]) ?? "";

    expect(claim).toContain("2 ship blockers stand:");
  });
});
