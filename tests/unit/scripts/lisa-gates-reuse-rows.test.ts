/**
 * Row-level and classification behaviour of the evidence-reuse verifier (#3013).
 *
 * A row-level failure affects ONE gate. Every test here asserts that, and also
 * asserts the negative that makes it a one-at-a-time fixture: no other gate's
 * decision moved. A verifier whose row failures leak into neighbouring
 * decisions cannot be reasoned about a dimension at a time, and a suite that
 * only checked the corrupted gate would never notice.
 * @module tests/unit/scripts/lisa-gates-reuse-rows
 */

import { describe, expect, it } from "vitest";

import {
  GATE_REUSE_CLASS,
  REGISTRY,
  REUSE_CLASSES,
  reusePlan,
  reusePolicyFor,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  BEHAVIOR_CONTRACT,
  CODE_STYLE,
  DEP_VULN,
  GATES,
  LEVEL_DOWNGRADE,
  MOMENT,
  NEVER_REUSABLE,
  NOT_PROVED,
  NOW_MS,
  OBSERVED,
  REUSE,
  RUN,
  STALE,
  STATIC_SECURITY,
  SUBJECT_MISMATCH,
  TEST_CORRECTNESS,
  UNATTRIBUTABLE,
  UNCOVERED,
  corruptRow,
  decisionsByGate,
  goldenEnvelope,
  reasonsByGate,
} from "./lisa-gates-reuse-fixtures";

/**
 * Plan against the fixtures.
 * @param {unknown} envelope The envelope under test.
 * @param {object} [extra] Extra `reusePlan` options.
 * @returns {object} The plan.
 */
function planFor(
  envelope: unknown,
  extra: Record<string, unknown> = {}
): { decisions: { decision: string; gate: string; reason: string }[] } {
  return reusePlan({
    envelope,
    gates: GATES,
    moment: MOMENT,
    nowMs: NOW_MS,
    observed: OBSERVED,
    ...extra,
  });
}

/** The golden decision map, which every corruption is compared against. */
const GOLDEN = decisionsByGate(planFor(goldenEnvelope()));

/**
 * Assert exactly one gate flipped to `run`, with the expected reason.
 * @param {unknown} envelope The corrupted envelope.
 * @param {string} gate The gate expected to flip.
 * @param {string} reason The expected reason token.
 * @param {object} [extra] Extra `reusePlan` options.
 */
function expectOnlyThisGateRan(
  envelope: unknown,
  gate: string,
  reason: string,
  extra: Record<string, unknown> = {}
): void {
  const plan = planFor(envelope, extra);
  const decisions = decisionsByGate(plan);
  expect(decisions[gate]).toBe(RUN);
  expect(reasonsByGate(plan)[gate]).toBe(reason);
  for (const [other, decision] of Object.entries(decisions)) {
    if (other === gate) continue;
    expect(decision).toBe(GOLDEN[other]);
  }
}

describe("reusePlan — a row that does not prove the gate", () => {
  it("runs the gate whose row is missing entirely", () => {
    expectOnlyThisGateRan(corruptRow(CODE_STYLE, null), CODE_STYLE, UNCOVERED);
  });

  it("runs the gate whose row failed", () => {
    expectOnlyThisGateRan(
      corruptRow(CODE_STYLE, { status: "fail" }),
      CODE_STYLE,
      NOT_PROVED
    );
  });

  it("runs the gate whose row is unknown", () => {
    expectOnlyThisGateRan(
      corruptRow(CODE_STYLE, { status: "unknown" }),
      CODE_STYLE,
      NOT_PROVED
    );
  });

  it("runs a work-declaring gate whose row counted no work", () => {
    expectOnlyThisGateRan(
      corruptRow(TEST_CORRECTNESS, { work: null }),
      TEST_CORRECTNESS,
      NOT_PROVED
    );
  });

  it("does NOT demote a gate that declares no work count", () => {
    const plan = planFor(corruptRow(CODE_STYLE, { work: null }));
    expect(decisionsByGate(plan)[CODE_STYLE]).toBe(REUSE);
  });
});

describe("reusePlan — evidence may never satisfy a stricter level", () => {
  it("runs a required gate proved only at optional", () => {
    expectOnlyThisGateRan(
      corruptRow(CODE_STYLE, { level: "optional" }),
      CODE_STYLE,
      LEVEL_DOWNGRADE
    );
  });

  it("runs a required gate whose row level is absent", () => {
    expectOnlyThisGateRan(
      corruptRow(CODE_STYLE, { level: null }),
      CODE_STYLE,
      LEVEL_DOWNGRADE
    );
  });

  it("runs a required gate proved only at off", () => {
    expectOnlyThisGateRan(
      corruptRow(CODE_STYLE, { level: "off" }),
      CODE_STYLE,
      LEVEL_DOWNGRADE
    );
  });
});

describe("reusePlan — time-sensitive evidence expires", () => {
  it("runs a time-sensitive gate observed past its window", () => {
    expectOnlyThisGateRan(
      corruptRow(DEP_VULN, {
        observed_at: new Date(NOW_MS - 61 * 60_000).toISOString(),
      }),
      DEP_VULN,
      STALE
    );
  });

  it("reuses a time-sensitive gate just inside its window", () => {
    const plan = planFor(
      corruptRow(DEP_VULN, {
        observed_at: new Date(NOW_MS - 59 * 60_000).toISOString(),
      })
    );
    expect(decisionsByGate(plan)[DEP_VULN]).toBe(REUSE);
  });

  it("does NOT expire a deterministic gate at the same age", () => {
    const plan = planFor(
      corruptRow(CODE_STYLE, {
        observed_at: new Date(NOW_MS - 61 * 60_000).toISOString(),
      })
    );
    expect(decisionsByGate(plan)[CODE_STYLE]).toBe(REUSE);
  });

  it("takes the TIGHTER of the row's own bound and the policy's", () => {
    expectOnlyThisGateRan(
      corruptRow(DEP_VULN, { max_age_minutes: 1 }),
      DEP_VULN,
      STALE
    );
  });

  it("runs a time-sensitive gate whose prover version is unknown", () => {
    expectOnlyThisGateRan(
      corruptRow(DEP_VULN, {
        prover: { tool: "x", version: null },
      }),
      DEP_VULN,
      UNATTRIBUTABLE
    );
  });

  it("does NOT require a prover version for a deterministic gate", () => {
    const plan = planFor(
      corruptRow(CODE_STYLE, { prover: { tool: "x", version: null } })
    );
    expect(decisionsByGate(plan)[CODE_STYLE]).toBe(REUSE);
  });
});

describe("reusePlan — a diff gate is bound to the commit, not only the tree", () => {
  it("runs the diff gate when the commit differs, and only that gate", () => {
    const plan = planFor(goldenEnvelope(), {
      observed: { ...OBSERVED, commit: `${"b".repeat(39)}c` },
    });
    const decisions = decisionsByGate(plan);
    expect(decisions[BEHAVIOR_CONTRACT]).toBe(RUN);
    expect(reasonsByGate(plan)[BEHAVIOR_CONTRACT]).toBe(SUBJECT_MISMATCH);
    expect(decisions[CODE_STYLE]).toBe(REUSE);
    expect(decisions[TEST_CORRECTNESS]).toBe(REUSE);
  });
});

describe("reusePolicyFor — the default is never, and it is fail-closed", () => {
  it("classifies an unknown gate id as never", () => {
    const policy = reusePolicyFor("a-gate-nobody-has-heard-of");
    expect(policy.class).toBe("never");
    expect(policy.known).toBe(false);
  });

  it("reports an unclassified gate as unclassified, not never-reusable", () => {
    const plan = reusePlan({
      envelope: goldenEnvelope(),
      gates: { ...GATES, CODE_STYLE: { "pull-request": "required" } },
      moment: MOMENT,
      nowMs: NOW_MS,
      observed: OBSERVED,
    });
    expect(reasonsByGate(plan)[STATIC_SECURITY]).toBe(NEVER_REUSABLE);
  });

  it("lets a project widen a built-in never to deterministic", () => {
    const plan = planFor(goldenEnvelope(), {
      gates: {
        ...GATES,
        [STATIC_SECURITY]: {
          "pull-request": "required",
          reuse: { class: "deterministic" },
        },
      },
    });
    expect(decisionsByGate(plan)[STATIC_SECURITY]).toBe(REUSE);
  });

  it("lets a project narrow a built-in deterministic to never", () => {
    const plan = planFor(goldenEnvelope(), {
      gates: {
        ...GATES,
        [CODE_STYLE]: { "pull-request": "required", reuse: { class: "never" } },
      },
    });
    expect(decisionsByGate(plan)[CODE_STYLE]).toBe(RUN);
  });

  it("refuses an unrecognised class rather than guessing", () => {
    const policy = reusePolicyFor(CODE_STYLE, {
      [CODE_STYLE]: { reuse: { class: "sometimes" } },
    });
    expect(policy.class).toBe("never");
  });
});

describe("GATE_REUSE_CLASS — no gate is reusable by accident", () => {
  it("classifies every registry gate, and no gate it does not have", () => {
    const registry = Object.keys(REGISTRY).sort((left, right) =>
      left.localeCompare(right)
    );
    const classified = Object.keys(GATE_REUSE_CLASS).sort((left, right) =>
      left.localeCompare(right)
    );
    expect(classified).toEqual(registry);
  });

  it("only ever uses a legal class", () => {
    for (const entry of Object.values(GATE_REUSE_CLASS)) {
      expect(REUSE_CLASSES).toContain(entry.class);
    }
  });

  it("gives every time-sensitive gate a declared window", () => {
    for (const [gate, entry] of Object.entries(GATE_REUSE_CLASS)) {
      if (entry.class !== "time-sensitive") continue;
      expect(entry.maxAgeMinutes, gate).toBeGreaterThan(0);
    }
  });

  it("never gives a non-time-sensitive gate a window", () => {
    for (const [gate, entry] of Object.entries(GATE_REUSE_CLASS)) {
      if (entry.class === "time-sensitive") continue;
      expect(entry.maxAgeMinutes, gate).toBeUndefined();
    }
  });
});
