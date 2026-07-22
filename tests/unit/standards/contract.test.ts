import { describe, expect, it } from "vitest";
import {
  STANDARDS_PROOF_ARTIFACT,
  validateStandardsProof,
} from "../../../src/standards/contract.js";

const NOW = new Date("2026-07-21T15:00:00.000Z");
const CHECK_ID = "typescript.lint";

/**
 * Build one valid strict proof candidate for tamper cases.
 * @returns Mutable candidate used only inside hostile-input tests
 */
function proof(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifact: STANDARDS_PROOF_ARTIFACT,
    lisaVersion: "2.278.0",
    registryDigest: `sha256:${"a".repeat(64)}`,
    configDigest: `sha256:${"b".repeat(64)}`,
    repository: {
      identity: "github.com/codyswanngt/lisa",
      head: "c".repeat(40),
      tree: "d".repeat(40),
    },
    projectTypes: ["typescript"],
    applicableChecks: [CHECK_ID],
    capturedAt: "2026-07-21T14:00:02.000Z",
    results: [
      {
        check: CHECK_ID,
        category: "lint",
        status: "pass",
        startedAt: "2026-07-21T14:00:00.000Z",
        completedAt: "2026-07-21T14:00:01.000Z",
      },
    ],
  };
}

describe("standards proof contract", () => {
  it("accepts and detaches one strict ordered proof", () => {
    const input = proof();
    const result = validateStandardsProof(input, NOW);
    expect(result.results[0]).toMatchObject({ status: "pass" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.results)).toBe(true);
  });

  it.each([
    ["unknown field", (value: any) => (value.extra = true)],
    ["bad schema", (value: any) => (value.schemaVersion = 2)],
    ["bad head", (value: any) => (value.repository.head = "main")],
    ["failed result", (value: any) => (value.results[0].status = "fail")],
    ["missing result", (value: any) => (value.results = [])],
    [
      "extra check",
      (value: any) => value.applicableChecks.push("typescript.test"),
    ],
    [
      "future timestamp",
      (value: any) => (value.capturedAt = "2026-07-22T00:00:00.000Z"),
    ],
  ])("rejects %s tampering", (_name, mutate) => {
    const candidate = proof();
    mutate(candidate);
    expect(() => validateStandardsProof(candidate, NOW)).toThrow();
  });

  it("reports duplicate membership before an invalid result", () => {
    const candidate = proof() as any;
    candidate.applicableChecks.push(CHECK_ID);
    candidate.results[0].status = "fail";
    expect(() => validateStandardsProof(candidate, NOW)).toThrow(
      "Invalid applicableChecks: entries must be unique"
    );
  });

  it("reports a future capture before an invalid result", () => {
    const candidate = proof() as any;
    candidate.capturedAt = "2026-07-22T00:00:00.000Z";
    candidate.results[0].status = "fail";
    expect(() => validateStandardsProof(candidate, NOW)).toThrow(
      "Invalid capturedAt: standards proof is from the future"
    );
  });
});
