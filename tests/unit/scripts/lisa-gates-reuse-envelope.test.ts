/**
 * Envelope-level refusals for the release evidence-reuse verifier (#3013).
 *
 * Every case here discards the WHOLE document, because each one says the
 * evidence is about a different subject, produced under a different contract,
 * or is not primary proof. The assertion is always the same and it is the
 * safety property the whole subsystem exists for: every gate runs, and nothing
 * is credited.
 *
 * The negative control at the bottom is what makes the rest mean anything — if
 * the golden envelope did not reuse, a suite of "everything ran" assertions
 * would pass against a verifier that never reuses at all.
 * @module tests/unit/scripts/lisa-gates-reuse-envelope
 */

import { describe, expect, it } from "vitest";

import { reusePlan } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  CODE_STYLE,
  CONTRACT_MISMATCH,
  DERIVATIVE,
  GATES,
  GATE_IDS,
  MALFORMED,
  MOMENT,
  NOT_PROVED,
  NOW_MS,
  OBSERVED,
  REUSABLE_IDS,
  REUSE,
  RUN,
  STATIC_SECURITY,
  SUBJECT_MISMATCH,
  UNATTRIBUTABLE,
  UNAVAILABLE,
  VERIFIED,
  corrupt,
  decisionsByGate,
  goldenEnvelope,
} from "./lisa-gates-reuse-fixtures";

/** The contract path every registry-version test corrupts. */
const REGISTRY_VERSION = "contract.registry_version";

/**
 * Plan against the fixtures with one envelope.
 * @param {unknown} envelope The envelope under test.
 * @param {object} [extra] Extra `reusePlan` options.
 * @returns {object} The plan.
 */
function planFor(
  envelope: unknown,
  extra: Record<string, unknown> = {}
): {
  decisions: {
    decision: string;
    gate: string;
    proof: string | null;
    reason: string;
  }[];
  detail: string | null;
  verdict: string;
} {
  return reusePlan({
    envelope,
    gates: GATES,
    moment: MOMENT,
    nowMs: NOW_MS,
    observed: OBSERVED,
    ...extra,
  });
}

/**
 * Assert every gate ran, with one reason token.
 * @param {unknown} envelope The envelope under test.
 * @param {string} reason The expected token.
 * @param {object} [extra] Extra `reusePlan` options.
 */
function expectAllRun(
  envelope: unknown,
  reason: string,
  extra: Record<string, unknown> = {}
): void {
  const plan = planFor(envelope, extra);
  expect(plan.verdict).toBe(reason);
  expect(plan.decisions).toHaveLength(GATE_IDS.length);
  for (const entry of plan.decisions) {
    expect(entry.decision).toBe(RUN);
    expect(entry.reason).toBe(reason);
    expect(entry.proof).toBeNull();
  }
}

describe("reusePlan — the golden envelope", () => {
  it("reuses every reusable gate and cites the originating run", () => {
    const plan = planFor(goldenEnvelope());
    expect(plan.verdict).toBe(VERIFIED);
    const decisions = decisionsByGate(plan);
    for (const gate of REUSABLE_IDS) expect(decisions[gate]).toBe(REUSE);
    for (const entry of plan.decisions) {
      if (entry.decision !== REUSE) continue;
      expect(entry.proof).toBe(
        "https://github.com/acme/widget/actions/runs/999"
      );
    }
  });

  it("still runs a never-reusable gate that carries a flawless row", () => {
    const plan = planFor(goldenEnvelope());
    const decisions = decisionsByGate(plan);
    expect(decisions[STATIC_SECURITY]).toBe(RUN);
  });
});

describe("reusePlan — absence and corruption discard the envelope", () => {
  it("runs everything when no envelope was supplied at all", () => {
    expectAllRun(null, MALFORMED);
  });

  it("runs everything when the caller already refused the file", () => {
    expectAllRun(null, UNAVAILABLE, {
      refusal: { detail: "no file", reason: UNAVAILABLE },
    });
  });

  it("runs everything when the envelope is an array, not an object", () => {
    expectAllRun([], MALFORMED);
  });

  it("runs everything when the schema token is wrong", () => {
    expectAllRun(corrupt("schema", "lisa.gate-evidence/v2"), MALFORMED);
  });

  it("runs everything when the schema token is absent", () => {
    expectAllRun(corrupt("schema", undefined), MALFORMED);
  });

  it("runs everything when gates is not an array", () => {
    expectAllRun(corrupt("gates", {}), MALFORMED);
  });
});

describe("reusePlan — a verdict other than proved is nothing to reuse", () => {
  for (const verdict of [
    "blocked",
    "refused",
    "no-gates",
    "fell-back",
    "runner-failed",
  ]) {
    it(`runs everything for verdict ${verdict}`, () => {
      expectAllRun(corrupt("verdict", verdict), NOT_PROVED);
    });
  }
});

describe("reusePlan — the subject must be the tree being released", () => {
  it("runs everything when the tree differs by one character", () => {
    expectAllRun(
      corrupt("subject.tree", `${"a".repeat(39)}b`),
      SUBJECT_MISMATCH
    );
  });

  it("runs everything when the tree is null", () => {
    expectAllRun(corrupt("subject.tree", null), SUBJECT_MISMATCH);
  });

  it("runs everything when the repository differs", () => {
    expectAllRun(corrupt("subject.repository", "acme/other"), SUBJECT_MISMATCH);
  });
});

describe("reusePlan — the contract must be the one being planned", () => {
  it("refuses a pre-deploy envelope for a pull-request plan", () => {
    expectAllRun(
      corrupt("contract.moment", "pre-deploy:production"),
      CONTRACT_MISMATCH
    );
  });

  for (const field of [
    "gates_digest",
    "inputs_digest",
    "workflow_ref",
    "workflow_sha",
  ]) {
    it(`runs everything when contract.${field} differs`, () => {
      expectAllRun(
        corrupt(`contract.${field}`, "different"),
        CONTRACT_MISMATCH
      );
    });

    it(`runs everything when contract.${field} is null`, () => {
      expectAllRun(corrupt(`contract.${field}`, null), CONTRACT_MISMATCH);
    });
  }

  it("runs everything when the producing registry is older", () => {
    expectAllRun(corrupt(REGISTRY_VERSION, "4.8.0"), CONTRACT_MISMATCH);
  });

  it("accepts a NEWER producing registry, because stricter is allowed", () => {
    const plan = planFor(corrupt(REGISTRY_VERSION, "4.10.0"));
    expect(plan.verdict).toBe(VERIFIED);
    expect(decisionsByGate(plan)[CODE_STYLE]).toBe(REUSE);
  });

  it("runs everything when the producing registry version is unknown", () => {
    expectAllRun(corrupt(REGISTRY_VERSION, null), CONTRACT_MISMATCH);
  });
});

describe("reusePlan — circular reuse is refused three ways", () => {
  it("refuses an envelope whose producer reused anything", () => {
    expectAllRun(corrupt("producer.reused_gates", [CODE_STYLE]), DERIVATIVE);
  });

  it("refuses an envelope with no reused_gates field at all", () => {
    expectAllRun(corrupt("producer.reused_gates", undefined), DERIVATIVE);
  });

  it("refuses a nested caller chain, which is the release path", () => {
    expectAllRun(
      corrupt("producer.caller_chain", ["🚀 Release", "🔍 Quality Checks"]),
      UNATTRIBUTABLE
    );
  });

  it("refuses a null caller chain rather than assuming it was shallow", () => {
    expectAllRun(corrupt("producer.caller_chain", null), UNATTRIBUTABLE);
  });
});

describe("reusePlan — evidence nobody can read back is not evidence", () => {
  it("refuses an envelope with no run id", () => {
    expectAllRun(corrupt("producer.run_id", null), UNATTRIBUTABLE);
  });

  it("refuses an envelope with no run url", () => {
    expectAllRun(corrupt("producer.run_url", null), UNATTRIBUTABLE);
  });
});
