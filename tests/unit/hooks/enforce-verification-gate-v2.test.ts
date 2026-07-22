/**
 * Schema-v2 behavior for the enforce-verification-gate.sh Stop hook.
 *
 * v2 binds every claim to a boundary and to the evidence kinds that reach it
 * (the claim-evidence-mapping contract). The gate applies those checks ON TOP
 * of the unchanged v1 conditions, and they are advisory-first: a violation is
 * reported to stderr but only blocks once
 * `verification.gate.enforceBoundaries` is ratcheted to true.
 *
 * The v1 conditions that still govern v2 (freshness, terminal status,
 * MAX_BLOCKS, fail-open) are re-pinned here against v2 verdicts, because
 * "v2 = v1 + claim checks" is the safety property the compat window rests on.
 * @module tests/unit/hooks/enforce-verification-gate-v2
 */
import {
  BROWSER_BOUNDARY,
  GATED_CLAIM_ID,
  SCREENSHOT_KIND,
  v2BoundaryMismatch,
  v2Verdict,
} from "../../helpers/verification-gate-fixtures";
import type { GateScenario } from "../../helpers/verification-gate-harness";
import {
  createGateScenario,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  FIXTURE_HEAD_SHA,
  MAX_BLOCKS,
} from "../../helpers/verification-gate-harness";

let harness: GateScenario;

const DRIFTED_SHA = "cccc333";

beforeEach(() => {
  harness = createGateScenario(process.env);
});

afterEach(() => {
  harness.cleanup();
});

describe("enforce-verification-gate.sh (schema v2)", () => {
  describe("v1 invariants still govern a v2 verdict", () => {
    it("releases a clean v2 verdict whose claims are all established", () => {
      harness.armSession("v2-clean");
      harness.writeVerdict(v2Verdict());
      expect(harness.stop("v2-clean").status).toBe(EXIT_ALLOWED);
    });

    it("releases a clean v2 verdict under enforcement", () => {
      harness.armSession("v2-clean-enforced");
      harness.writeConfig(true);
      harness.writeVerdict(v2Verdict());
      expect(harness.stop("v2-clean-enforced").status).toBe(EXIT_ALLOWED);
    });

    it("still applies the freshness check to a v2 verdict", () => {
      harness.armSession("v2-stale");
      harness.writeVerdict(v2Verdict(), { stale: true });
      expect(harness.stop("v2-stale").status).toBe(EXIT_BLOCKED);
    });

    it("releases a v2 blocked verdict without applying claim checks", () => {
      harness.armSession("v2-blocked");
      harness.writeConfig(true);
      harness.writeVerdict(
        v2Verdict({
          status: "blocked",
          claims: [],
          not_established_reviewed: true,
        })
      );
      expect(harness.stop("v2-blocked").status).toBe(EXIT_ALLOWED);
    });

    it("does not crash on a malformed v2 verdict", () => {
      harness.armSession("v2-malformed");
      harness.writeConfig(true);
      harness.writeVerdict('{ "schema_version": 2, "claims": [ }');
      expect(harness.stop("v2-malformed").status).toBe(EXIT_BLOCKED);
    });

    it("escalates after MAX_BLOCKS on a v2 verdict too", () => {
      const session = "v2-escalate";
      harness.armSession(session);
      harness.writeConfig(true);
      harness.writeVerdict(v2BoundaryMismatch());
      for (let i = 0; i < MAX_BLOCKS; i += 1) {
        expect(harness.stop(session).status).toBe(EXIT_BLOCKED);
      }
      expect(harness.stop(session).status).toBe(EXIT_ALLOWED);
    });

    it("falls back to the v1 decision for an unrecognized schema_version", () => {
      harness.armSession("v2-unknown");
      harness.writeConfig(true);
      harness.writeVerdict(
        JSON.stringify({
          ...(JSON.parse(v2BoundaryMismatch()) as Record<string, unknown>),
          schema_version: 99,
        })
      );
      expect(harness.stop("v2-unknown").status).toBe(EXIT_ALLOWED);
    });

    it("accepts and ignores a top-level not_established list", () => {
      harness.armSession("v2-notest");
      harness.writeConfig(true);
      harness.writeVerdict(v2Verdict({ not_established: ["mobile viewport"] }));
      expect(harness.stop("v2-notest").status).toBe(EXIT_ALLOWED);
    });
  });

  describe("boundary enforcement is advisory-first", () => {
    it("reports a boundary mismatch but still releases when enforcement is off", () => {
      harness.armSession("v2-advisory");
      harness.writeConfig(false);
      harness.writeVerdict(v2BoundaryMismatch());
      const { status, stderr } = harness.stop("v2-advisory");
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(GATED_CLAIM_ID);
      expect(stderr).toContain(BROWSER_BOUNDARY);
      expect(stderr).toContain(SCREENSHOT_KIND);
    });

    it("treats a missing config as enforcement off", () => {
      harness.armSession("v2-noconfig");
      harness.writeVerdict(v2BoundaryMismatch());
      const { status, stderr } = harness.stop("v2-noconfig");
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(GATED_CLAIM_ID);
    });

    it("blocks a boundary mismatch when enforcement is on, naming the claim", () => {
      harness.armSession("v2-enforced");
      harness.writeConfig(true);
      harness.writeVerdict(v2BoundaryMismatch());
      const { status, stderr } = harness.stop("v2-enforced");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain(GATED_CLAIM_ID);
      expect(stderr).toContain(BROWSER_BOUNDARY);
      expect(stderr).toContain(SCREENSHOT_KIND);
    });

    it("states the boundary violation as the block reason, not the v1 fallback", () => {
      harness.armSession("v2-reason");
      harness.writeConfig(true);
      harness.writeVerdict(v2BoundaryMismatch());
      const { stderr } = harness.stop("v2-reason");
      expect(stderr).toContain("reaches that claim's boundary");
      expect(stderr).not.toContain("status is not pass/blocked");
    });

    it("blocks a gated claim that is not established", () => {
      harness.armSession("v2-notestablished");
      harness.writeConfig(true);
      harness.writeVerdict(
        v2Verdict({
          claims: [
            {
              claim_id: "AC-9",
              statement: "the API returns 200",
              boundary: "http-api",
              required_for_gate: true,
              required_evidence_kinds: ["http-transcript"],
              status: "not-established",
              evidence_refs: [],
            },
          ],
        })
      );
      const { status, stderr } = harness.stop("v2-notestablished");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("AC-9");
    });

    it("blocks a claim whose evidence_refs resolve to nothing", () => {
      harness.armSession("v2-dangling");
      harness.writeConfig(true);
      harness.writeVerdict(v2Verdict({ evidence: [] }));
      const { status, stderr } = harness.stop("v2-dangling");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain(GATED_CLAIM_ID);
    });

    it("ignores claims that are not required_for_gate", () => {
      harness.armSession("v2-optional");
      harness.writeConfig(true);
      harness.writeVerdict(
        v2Verdict({
          claims: [
            {
              claim_id: GATED_CLAIM_ID,
              boundary: BROWSER_BOUNDARY,
              required_for_gate: true,
              required_evidence_kinds: [SCREENSHOT_KIND],
              status: "established",
              evidence_refs: ["EV-1"],
            },
            {
              claim_id: "AC-2",
              boundary: BROWSER_BOUNDARY,
              required_for_gate: false,
              required_evidence_kinds: [SCREENSHOT_KIND],
              status: "not-established",
              evidence_refs: [],
            },
          ],
        })
      );
      expect(harness.stop("v2-optional").status).toBe(EXIT_ALLOWED);
    });
  });

  describe("not_established_reviewed may never be omitted", () => {
    const withoutReviewFlag = (): string => {
      const verdict = JSON.parse(v2Verdict()) as Record<string, unknown>;
      delete verdict.not_established_reviewed;
      return JSON.stringify(verdict);
    };

    it("blocks when the flag is omitted under enforcement", () => {
      harness.armSession("v2-noreview");
      harness.writeConfig(true);
      harness.writeVerdict(withoutReviewFlag());
      const { status, stderr } = harness.stop("v2-noreview");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("not_established_reviewed");
    });

    it("only warns when the flag is omitted and enforcement is off", () => {
      harness.armSession("v2-noreview-advisory");
      harness.writeConfig(false);
      harness.writeVerdict(withoutReviewFlag());
      const { status, stderr } = harness.stop("v2-noreview-advisory");
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("not_established_reviewed");
    });
  });

  describe("artifact identity", () => {
    it("blocks a v2 pass verdict missing artifact.head_sha under enforcement", () => {
      harness.armSession("v2-nohead");
      harness.writeConfig(true);
      harness.writeVerdict(
        v2Verdict({ artifact: { repository: "CodySwannGT/lisa" } })
      );
      const { status, stderr } = harness.stop("v2-nohead");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("head_sha");
    });

    it("blocks evidence captured at a different artifact head_sha", () => {
      harness.armSession("v2-shadrift");
      harness.writeConfig(true);
      harness.writeVerdict(
        v2Verdict({
          evidence: [
            {
              evidence_id: "EV-1",
              kind: SCREENSHOT_KIND,
              locator: "evidence/1836/button.png",
              captured_at: "2026-07-20T00:00:00Z",
              artifact_head_sha: DRIFTED_SHA,
            },
          ],
        })
      );
      const { status, stderr } = harness.stop("v2-shadrift");
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain(DRIFTED_SHA);
      expect(stderr).toContain(FIXTURE_HEAD_SHA);
    });
  });
});
