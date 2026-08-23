/**
 * Tests that the report keeps declared / mapped / executed / pass-fail-skip /
 * waived apart, and that it never invents a number it does not have.
 */
import { describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

import {
  ENFORCED,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_FEATURE_FILE,
  HOME_ID,
  HOME_SPEC,
  PLAYWRIGHT,
  RATIFIED,
  WEB,
  commitAll,
  featureSource,
  healthyProject,
  makeProject,
  runGate,
  runReport,
} from "./bdd/support";

/**
 * Liveness bound for the 2000-scenario case, calibrated to this machine.
 *
 * 60s, reverted from 180s by CodySwannGT/lisa#2892. The 180s base was
 * CodySwannGT/lisa#2888's, sized at 5.4x a measured 33,571ms — but that
 * measurement was taken while the bdd fixtures still dispatched git through
 * Apple's `xcrun` shim, whose maximum reaches ~20,727ms under load against
 * 11ms for a real binary. CodySwannGT/lisa#2889 removed the shim, and this
 * case was re-measured across nine runs (130,869 pooled cases, loads 28-175,
 * three of them coverage-instrumented): its worst draw is 6,872ms, 4.9x below
 * the number the raise was sized on. Re-measured again under three CONCURRENT
 * suites — the fleet condition, load 155 — it reaches 12,507ms. 60s is 4.8x
 * that concurrent draw and 8.7x the sequential one, and still catches the
 * blowup this bound exists for.
 *
 * It remains a FLOOR rather than a cap — the same number, scaled by the box
 * — because a fixed one cannot survive a machine whose spawn cost moves 4x
 * under load (CodySwannGT/lisa#2822, CodySwannGT/lisa#2894). The complexity
 * claim this file once made is still dropped; this is only the backstop.
 */
const LARGE_CONTRACT_BUDGET_MS = ioLatencyBudgetMs(60_000);

const RESULTS_FILE = "results.json";

/**
 * Build an execution-result document.
 * @param results - Individual test outcomes.
 * @returns Serialized document.
 */
function resultsDoc(
  results: readonly { file: string; evidence: string; status: string }[]
): string {
  return JSON.stringify({
    schemaVersion: 1,
    runner: PLAYWRIGHT,
    runId: "run-1",
    completedAt: "2026-08-12T09:00:00Z",
    results,
  });
}

describe("honest reporting", () => {
  it("emits no execution counts at all when no run evidence is supplied", () => {
    const execution = runReport(healthyProject(), {
      BDD_MODE: ENFORCED,
    }).execution;
    expect(execution.supplied).toBe(false);
    expect(execution.executed).toBeUndefined();
    expect(execution.passed).toBeUndefined();
    expect(String(execution.note)).toContain("not that it ran or passed");
    const root = healthyProject();
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: commitAll(root),
    });
    expect(run.envelope.summary.headline).toContain(
      "no execution evidence supplied"
    );
    // Absent evidence emits no counters at all, not zeros.
    expect(run.envelope.summary.executed).toBeUndefined();
    expect(run.envelope.summary.passed).toBeUndefined();
  });

  it("separates declared, mapped, executed, and pass/fail/skip", () => {
    const root = healthyProject(
      {},
      {
        files: {
          [RESULTS_FILE]: resultsDoc([
            { file: HOME_SPEC, evidence: HOME_EVIDENCE, status: "failed" },
          ]),
        },
      }
    );
    const base = commitAll(root);
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_EXECUTION_RESULTS: RESULTS_FILE,
    });
    const report = runReport(root, {
      BDD_MODE: ENFORCED,
      BDD_BASE_SHA: base,
      BDD_EXECUTION_RESULTS: RESULTS_FILE,
    });
    expect(report.scenarios.declared).toBe(1);
    expect(report.traceability.overall).toMatchObject({
      covered: 1,
      total: 1,
      percentage: 100,
    });
    expect(report.execution).toMatchObject({
      supplied: true,
      mappedTests: 1,
      executed: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      notRun: 0,
    });
    // A failing mapped test is still fully traced. Traceability is not a pass
    // rate, and the gate must never conflate them.
    expect(run.status).toBe(0);
    expect(report.traceability.note).toContain("not execution coverage");
    expect(run.envelope.summary).toMatchObject({
      traceabilityCovered: 1,
      traceabilityTotal: 1,
      executed: 1,
      failed: 1,
      passed: 0,
    });
  });

  it("counts a mapped test with no result as notRun, never as passing", () => {
    const root = healthyProject(
      {},
      { files: { [RESULTS_FILE]: resultsDoc([]) } }
    );
    const run = runGate(root, {
      BDD_MODE: ENFORCED,
      BDD_EXECUTION_RESULTS: RESULTS_FILE,
    });
    expect(run.envelope.summary).toMatchObject({
      executed: 0,
      notRun: 1,
      passed: 0,
    });
  });

  it("reports a missing or malformed results document instead of ignoring it", () => {
    const run = runGate(healthyProject(), {
      BDD_MODE: ENFORCED,
      BDD_EXECUTION_RESULTS: "nowhere.json",
    });
    expect(run.envelope.findings.map(item => item.code)).toContain(
      "execution-results"
    );
  });

  it("keeps waived obligations out of the denominator and names their owner", () => {
    const root = makeProject({
      map: {
        ...HEALTHY_MAP,
        mappings: [],
        platformWaivers: [
          {
            scenario: HOME_ID,
            platforms: [WEB],
            reason: "no request interception in this runner",
            owner: "cody@example.test",
            ticket: "gh-2394",
            recordedAt: "2026-08-01",
            expiresAt: "2026-12-31",
          },
        ],
      },
      features: {
        [HOME_FEATURE_FILE]: featureSource("Home", [
          { id: HOME_ID, tags: [WEB, RATIFIED, "TUN-123"] },
        ]),
      },
      files: {},
    });
    const report = runReport(root, { BDD_MODE: "bootstrap" });
    expect(report.waived.count).toBe(1);
    expect(report.traceability.overall.total).toBe(0);
    expect(report.gaps).toEqual([]);
  });

  it("produces byte-identical output across runs", () => {
    const root = healthyProject();
    const first = runGate(root, { BDD_MODE: ENFORCED });
    const second = runGate(root, { BDD_MODE: ENFORCED });
    expect(JSON.stringify(first.envelope)).toBe(
      JSON.stringify(second.envelope)
    );
  });

  it("indexes tracker tags with emitted links", () => {
    const root = healthyProject({
      trackers: {
        keys: ["TUN"],
        keyUrlTemplate: "https://linear.app/t/issue/{id}",
        github: {
          org: "AcmeOrgD",
          defaultRepo: "frontend",
          repos: ["frontend"],
        },
      },
    });
    expect(runReport(root, { BDD_MODE: ENFORCED }).trackers.tags).toEqual([
      {
        tag: "TUN-123",
        url: "https://linear.app/t/issue/TUN-123",
        scenarios: [HOME_ID],
      },
    ]);
  });
});

/**
 * Build a contract of `count` fully-mapped scenarios and run the gate over it.
 * @param count - How many scenarios to declare.
 * @returns The gate result and how long the gate itself took, in ms.
 */
function timeGateAtScale(count: number): {
  run: ReturnType<typeof runGate>;
  elapsed: number;
} {
  const scenarios = Array.from({ length: count }, (_, index) => ({
    id: `BDD-BULK-${String(index + 1).padStart(4, "0")}`,
    tags: [WEB, RATIFIED],
  }));
  const files: Record<string, string> = {};
  const mappings = scenarios.map((spec, index) => {
    files[`e2e/bulk-${index}.spec.ts`] =
      `test("proves ${spec.id}", () => {});\n`;
    return {
      scenario: spec.id,
      runner: PLAYWRIGHT,
      platforms: [WEB],
      file: `e2e/bulk-${index}.spec.ts`,
      evidence: `proves ${spec.id}`,
      level: "behavioral",
    };
  });
  const root = makeProject({
    map: { ...HEALTHY_MAP, coverageFloor: { [WEB]: 100 }, mappings },
    features: { "bulk.feature": featureSource("Bulk", scenarios) },
    files,
  });
  // Committed, so the base-revision checks are IN the measurement: the
  // non-regression comparisons are set operations over the same obligations
  // and must not be where the quadratic term hides.
  const base = commitAll(root);
  const started = Date.now();
  const run = runGate(root, { BDD_MODE: ENFORCED, BDD_BASE_SHA: base });
  return { run, elapsed: Date.now() - started };
}

describe("scale", () => {
  // WHAT IS DELIBERATELY NOT ASSERTED HERE, AND WHY — read before adding a
  // timing bound back.
  //
  // This test carried `expect(Date.now() - started).toBeLessThan(30_000)`,
  // described as proving "no quadratic blowup". It proved no such thing, and
  // it failed in CI for the only reason it ever could: a loaded scheduler.
  //
  // Measured rather than argued. The gate costs ~260ms at n=2000 and ~123ms at
  // n=500, so the 30s bound sat about a hundred times above the work — it
  // could only fire when the machine stalled, which is precisely what
  // happened. Replacing it with a machine-independent RATIO (n=500 against
  // n=2000, best-of-three) looked better and was still hollow. Injecting a
  // real O(n²) pass over the scenarios array moved the ratio from
  //
  //     2.13  ->  2.33
  //
  // because at n=2000 the quadratic term is roughly 30ms against a ~260ms
  // baseline that is dominated by reading one file per scenario. No threshold
  // separates those, and no timing instrument can at this fixture size: the
  // input would have to grow until n² dominates file I/O, which costs far more
  // to build than the regression costs to catch.
  //
  // So the complexity claim is dropped rather than dressed up. A guard that
  // cannot fail is the defect this repository catalogues, and keeping a
  // flaky one that also cannot fail is the worst of both. The `timeout`
  // below remains the honest backstop: it catches a blowup severe enough to
  // matter, and claims nothing finer.
  //
  // Raised 60s -> 180s (#2885), then REVERTED to 60s (#2892). The raise was
  // sized on a 33,571ms measurement of this case, which was real but was taken
  // while the bdd fixtures still went through the xcrun git shim; #2889 removed
  // it. Re-measured across nine runs at loads 28-175 this case's worst draw is
  // 6,872ms, so the 33,571ms it was sized on no longer reproduces and 180s
  // became 26x a cost that had already fallen 4.9x.
  //
  // The reason the raise was made in the same change as the file-level one
  // still holds and is why the revert is too: a per-case budget overrides the
  // file-level one SILENTLY, so moving vitest.config.local.ts alone leaves this
  // case governed by a number nobody re-derived. See LARGE_CONTRACT_BUDGET_MS
  // above for the full re-measurement.
  it(
    "handles a very large contract",
    () => {
      const count = 2000;
      const { run } = timeGateAtScale(count);
      expect(run.status).toBe(0);
      expect(run.envelope.summary.scenariosDeclared).toBe(count);
      expect(run.envelope.summary.traceabilityCovered).toBe(count);
    },
    LARGE_CONTRACT_BUDGET_MS
  );
});
