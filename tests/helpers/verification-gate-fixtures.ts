/**
 * Verdict fixtures for the enforce-verification-gate.sh tests.
 *
 * Kept beside the harness so the v1 and v2 suites build their verdicts from
 * one definition of each schema — a v1 fixture that drifted from the real v1
 * shape would silently weaken the compatibility proof.
 * @module tests/helpers/verification-gate-fixtures
 */
import {
  FIXTURE_HEAD_SHA,
  FIXTURE_TIMESTAMP,
} from "./verification-gate-harness";

/** Boundary asserted by the default v2 fixture claim. */
export const BROWSER_BOUNDARY = "browser";

/** Evidence kind that reaches the browser boundary. */
export const SCREENSHOT_KIND = "screenshot";

/** Evidence kind that reaches only the code-unit boundary. */
export const UNIT_LOG_KIND = "test-run-log";

/** Claim id used by the default v2 fixture. */
export const GATED_CLAIM_ID = "AC-1";

/** Evidence id used by the default v2 fixture. */
const EVIDENCE_ID = "EV-1";

/** A criterion in the legacy criteria[] array that passed. */
export const PASSING_CRITERION = {
  task: "T1",
  criterion: "the gate releases",
  status: "pass",
  evidence: "ran the hook, observed exit 0",
};

/** A criterion in the legacy criteria[] array that failed. */
export const FAILING_CRITERION = {
  task: "T2",
  criterion: "the gate blocks",
  status: "fail",
  evidence: "observed exit 0, expected 2",
};

/**
 * Builds a legacy v1 verdict.
 * @param status - Overall verdict status.
 * @param criteria - The legacy criteria entries.
 * @param extra - Extra top-level fields (e.g. an explicit schema_version).
 * @returns Serialized verdict JSON.
 */
export const v1Verdict = (
  status: string,
  criteria: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {}
): string =>
  JSON.stringify({
    plan: "bce-2",
    status,
    criteria,
    updated_at: FIXTURE_TIMESTAMP,
    ...extra,
  });

/**
 * Builds a v2 verdict. Defaults describe a clean, all-established browser
 * claim proven by a screenshot captured at the verdict's own head_sha.
 * @param overrides - Top-level fields to replace on the default verdict.
 * @returns Serialized verdict JSON.
 */
export const v2Verdict = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema_version: 2,
    plan: "bce-2",
    artifact: {
      repository: "CodySwannGT/lisa",
      base_sha: "aaaa111",
      head_sha: FIXTURE_HEAD_SHA,
      build_id: "build-1",
      environment: "local",
      observed_at: FIXTURE_TIMESTAMP,
    },
    claims: [
      {
        claim_id: GATED_CLAIM_ID,
        statement: "the button works in the browser",
        boundary: BROWSER_BOUNDARY,
        required_for_gate: true,
        required_evidence_kinds: [SCREENSHOT_KIND, "recording"],
        status: "established",
        evidence_refs: [EVIDENCE_ID],
        not_established: [],
      },
    ],
    evidence: [
      {
        evidence_id: EVIDENCE_ID,
        kind: SCREENSHOT_KIND,
        locator: "evidence/1836/button.png",
        sha256: "deadbeef",
        captured_at: FIXTURE_TIMESTAMP,
        artifact_head_sha: FIXTURE_HEAD_SHA,
      },
    ],
    not_established_reviewed: true,
    criteria: [PASSING_CRITERION],
    status: "pass",
    updated_at: FIXTURE_TIMESTAMP,
    ...overrides,
  });

/**
 * A v2 verdict whose gated browser claim cites only a unit test-run-log —
 * the canonical claim/evidence boundary violation.
 * @returns Serialized verdict JSON.
 */
export const v2BoundaryMismatch = (): string =>
  v2Verdict({
    evidence: [
      {
        evidence_id: EVIDENCE_ID,
        kind: UNIT_LOG_KIND,
        locator: "evidence/1836/unit.txt",
        sha256: "deadbeef",
        captured_at: FIXTURE_TIMESTAMP,
        artifact_head_sha: FIXTURE_HEAD_SHA,
      },
    ],
  });
