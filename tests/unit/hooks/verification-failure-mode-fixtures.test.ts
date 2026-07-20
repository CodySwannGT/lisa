/**
 * BCE-6 (#1840): the five failure-mode verdict fixtures, executable.
 *
 * Each named failure mode from the bounded-claims PRD becomes a committed
 * verdict under `tests/fixtures/verification/` that this suite drives through
 * the REAL Stop hook — the same harness the v1/v2 suites use. A fixture is not
 * a description of a failure mode; it is the failure mode, run.
 *
 * The suite is advisory-first by construction: every detector fixture is run
 * twice, once with `verification.gate.enforceBoundaries` false and once true,
 * and BOTH legs are asserted. Advisory mode must still *report* — a detector
 * that silently degrades to "clean" while advisory would be indistinguishable
 * from a working one right up until the ratchet flips it to blocking, which is
 * exactly the bypass this ticket exists to close. The enforcement-ON legs set
 * the flag in the scenario's own throwaway config; no repo default is flipped.
 *
 * CI: these are plain vitest tests under `tests/unit`, so they run in the
 * existing required `🧪 Run Unit Tests` job (`bun run test:unit`) — the check
 * that already gates every PR. No separate job, and nothing here is skipped or
 * capped: what is advisory versus blocking is asserted per fixture below and
 * named in the hook's own stderr, never silently dropped.
 * @module tests/unit/hooks/verification-failure-mode-fixtures
 */
import { existsSync } from "fs";
import path from "path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { loadFailureModeFixture } from "../../helpers/verification-gate-fixtures";
import type { GateScenario } from "../../helpers/verification-gate-harness";
import {
  createGateScenario,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  MAX_BLOCKS,
} from "../../helpers/verification-gate-harness";

/** The ratchet flag every v2 check rides. Named in the advisory output. */
const RATCHET_FLAG = "verification.gate.enforceBoundaries";

/** head_sha the fixtures' verdicts claim to have observed. */
const VERDICT_HEAD_SHA = "bbbb222";

/** head_sha the artifact_mismatch fixture's evidence was captured at. */
const STALE_EVIDENCE_HEAD_SHA = "9999aaa";

/** Locator every screenshot-bearing fixture records for its evidence. */
const EVIDENCE_LOCATOR = "evidence/1840/confirmation.png";

/** The bytes whose digest the fixtures record. */
const EVIDENCE_BYTES = "captured screenshot bytes v1\n";

/** The digest recorded in the fixtures for EVIDENCE_BYTES. */
const RECORDED_DIGEST =
  "990a93ea77cc735408f25a80e9b4dd048a771c0c27f4c106a8404632dd86a1ce";

/** Bytes that replace the evidence after it was recorded. */
const TAMPERED_BYTES = "captured screenshot bytes v2 (tampered)\n";

/** The five failure modes the PRD names, plus the compatibility fixture. */
const NAMED_FAILURE_MODES = [
  "evidence_kind_mismatch",
  "artifact_mismatch",
  "evidence_digest_mismatch",
  "pass_with_named_unproved_edge",
  "security_shaped_without_reproducer",
] as const;

let harness: GateScenario;

beforeEach(() => {
  harness = createGateScenario(process.env);
});

afterEach(() => {
  harness.cleanup();
});

/**
 * Runs one fixture through the real hook at a given enforcement posture.
 * @param fixture - Fixture basename under tests/fixtures/verification.
 * @param enforce - Value written to verification.gate.enforceBoundaries.
 * @returns The hook's exit status and stderr.
 */
const runFixture = (
  fixture: string,
  enforce: boolean
): { status: number | null; stderr: string } => {
  const session = `${fixture}-${enforce ? "on" : "off"}`;
  harness.armSession(session);
  harness.writeConfig(enforce);
  harness.writeVerdict(loadFailureModeFixture(fixture));
  return harness.stop(session);
};

describe("verification failure-mode fixtures (BCE-6)", () => {
  describe("every named failure mode is a committed, executable fixture", () => {
    it.each(NAMED_FAILURE_MODES)("ships a %s fixture", name => {
      expect(
        existsSync(path.resolve("tests/fixtures/verification", `${name}.json`))
      ).toBe(true);
      expect(JSON.parse(loadFailureModeFixture(name))).toBeTypeOf("object");
    });
  });

  describe("v2_pass_clean: a claim-mapped verdict passes end to end", () => {
    it("releases the gate when enforcement is off", () => {
      expect(runFixture("v2_pass_clean", false).status).toBe(EXIT_ALLOWED);
    });

    it("releases the gate when enforcement is on", () => {
      expect(runFixture("v2_pass_clean", true).status).toBe(EXIT_ALLOWED);
    });

    it("reports nothing — a clean verdict raises no advisory", () => {
      expect(runFixture("v2_pass_clean", false).stderr).not.toContain(
        "advisory"
      );
    });
  });

  describe("evidence_kind_mismatch: a unit log cited for a browser claim", () => {
    it("reports the mismatch and still releases while advisory", () => {
      const { status, stderr } = runFixture("evidence_kind_mismatch", false);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("AC-1");
      expect(stderr).toContain("browser");
      expect(stderr).toContain("test-run-log");
      expect(stderr).toContain("screenshot");
    });

    it("blocks the stop once enforcement is on", () => {
      const { status, stderr } = runFixture("evidence_kind_mismatch", true);
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("AC-1");
      expect(stderr).toContain("reaches that claim's boundary");
    });
  });

  describe("artifact_mismatch: evidence captured on a previous head", () => {
    it("names both SHAs while advisory and releases", () => {
      const { status, stderr } = runFixture("artifact_mismatch", false);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(STALE_EVIDENCE_HEAD_SHA);
      expect(stderr).toContain(VERDICT_HEAD_SHA);
    });

    it("fails loudly naming both SHAs once enforcement is on", () => {
      const { status, stderr } = runFixture("artifact_mismatch", true);
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain(STALE_EVIDENCE_HEAD_SHA);
      expect(stderr).toContain(VERDICT_HEAD_SHA);
      expect(stderr).toContain("EV-1");
    });
  });

  describe("evidence_digest_mismatch: the bytes changed after recording", () => {
    /**
     * Runs the digest fixture with the evidence file materialized.
     * @param bytes - Bytes written at the recorded locator.
     * @param enforce - Enforcement posture.
     * @returns The hook's exit status and stderr.
     */
    const runWithEvidence = (
      bytes: string,
      enforce: boolean
    ): { status: number | null; stderr: string } => {
      const session = `digest-${enforce ? "on" : "off"}`;
      harness.armSession(session);
      harness.writeConfig(enforce);
      harness.writeEvidenceFile(EVIDENCE_LOCATOR, bytes);
      harness.writeVerdict(loadFailureModeFixture("evidence_digest_mismatch"));
      return harness.stop(session);
    };

    it("reports the tampered digest while advisory and releases", () => {
      const { status, stderr } = runWithEvidence(TAMPERED_BYTES, false);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("EV-1");
      expect(stderr).toContain(RECORDED_DIGEST);
    });

    it("blocks once enforcement is on, naming the evidence id", () => {
      const { status, stderr } = runWithEvidence(TAMPERED_BYTES, true);
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("EV-1");
      expect(stderr).toContain(EVIDENCE_LOCATOR);
    });

    it("releases when the bytes still match the recorded digest", () => {
      const { status, stderr } = runWithEvidence(EVIDENCE_BYTES, true);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).not.toContain("digest");
    });

    it("does not invent a digest failure when the artifact is not on disk", () => {
      expect(runFixture("evidence_digest_mismatch", true).status).toBe(
        EXIT_ALLOWED
      );
    });
  });

  describe("pass_with_named_unproved_edge: a pass that names its edges", () => {
    it("stays a pass under enforcement", () => {
      expect(runFixture("pass_with_named_unproved_edge", true).status).toBe(
        EXIT_ALLOWED
      );
    });

    it("keeps the unproved edge states visible in the verdict", () => {
      const verdict = JSON.parse(
        loadFailureModeFixture("pass_with_named_unproved_edge")
      ) as {
        not_established: string[];
        not_established_reviewed: boolean;
      };
      expect(verdict.not_established_reviewed).toBe(true);
      expect(verdict.not_established.length).toBeGreaterThan(0);
      expect(verdict.not_established.join(" ")).toContain("mobile Safari");
    });
  });

  describe("not_established_unreviewed: the flag may never be omitted", () => {
    it("reports the missing flag while advisory and releases", () => {
      const { status, stderr } = runFixture(
        "not_established_unreviewed",
        false
      );
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("not_established_reviewed");
    });

    it("blocks once enforcement is on", () => {
      const { status, stderr } = runFixture("not_established_unreviewed", true);
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("not_established_reviewed");
    });
  });

  describe("security_shaped_without_reproducer: unproven, never dropped", () => {
    it("shapes the report, not the merge — the gate still releases", () => {
      expect(
        runFixture("security_shaped_without_reproducer", true).status
      ).toBe(EXIT_ALLOWED);
    });

    it("keeps the finding in the security bucket labeled unproven", () => {
      const verdict = JSON.parse(
        loadFailureModeFixture("security_shaped_without_reproducer")
      ) as {
        security_findings: Array<Record<string, string>>;
      };
      const [finding] = verdict.security_findings;
      expect(finding?.bucket).toBe("security-unproven");
      expect(finding?.reproducer).toBe("none");
      expect(finding?.impact).toBe("unproven");
      expect(finding?.reason).toContain("reproducer");
    });

    it("never demotes the finding to a maintenance bucket", () => {
      expect(
        loadFailureModeFixture("security_shaped_without_reproducer")
      ).not.toContain("maintenance");
    });
  });

  describe("v2_structurally_invalid_claims: could-not-evaluate is not clean", () => {
    it("does NOT silently release under enforcement", () => {
      const { status } = runFixture("v2_structurally_invalid_claims", true);
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the structural problem instead of a generic failure", () => {
      const { stderr } = runFixture("v2_structurally_invalid_claims", true);
      expect(stderr).toContain("could not be evaluated");
      expect(stderr).toContain("claims");
      expect(stderr).toContain("evidence");
    });

    it("surfaces the same structural problem as an advisory when off", () => {
      const { status, stderr } = runFixture(
        "v2_structurally_invalid_claims",
        false
      );
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("could not be evaluated");
    });

    it("never hard-wedges — it releases after MAX_BLOCKS with escalation", () => {
      const session = "structural-wedge";
      harness.armSession(session);
      harness.writeConfig(true);
      harness.writeVerdict(
        loadFailureModeFixture("v2_structurally_invalid_claims")
      );
      for (let i = 0; i < MAX_BLOCKS; i += 1) {
        expect(harness.stop(session).status).toBe(EXIT_BLOCKED);
      }
      const escalated = harness.stop(session);
      expect(escalated.status).toBe(EXIT_ALLOWED);
      expect(escalated.stderr).toContain("Do NOT claim this work is verified");
    });
  });

  describe("v1_back_compat: the compatibility window is regression-guarded", () => {
    it("releases a v1 verdict exactly as the pre-v2 gate did", () => {
      expect(runFixture("v1_back_compat", true).status).toBe(EXIT_ALLOWED);
    });

    it("applies no v2 claim check to a v1 verdict, even a structurally odd one", () => {
      const session = "v1-odd";
      harness.armSession(session);
      harness.writeConfig(true);
      harness.writeVerdict(
        JSON.stringify({
          ...(JSON.parse(loadFailureModeFixture("v1_back_compat")) as Record<
            string,
            unknown
          >),
          claims: "not a v2 verdict",
        })
      );
      const { status, stderr } = harness.stop(session);
      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toBe("");
    });
  });

  describe("advisory versus blocking is logged, never silent", () => {
    it("names the ratchet flag that would make the report blocking", () => {
      const { stderr } = runFixture("evidence_kind_mismatch", false);
      expect(stderr).toContain(RATCHET_FLAG);
      expect(stderr).toContain("advisory");
    });
  });
});
