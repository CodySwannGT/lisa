/**
 * Tests that the report keeps declared / mapped / executed / pass-fail-skip /
 * waived apart, and that it never invents a number it does not have.
 */
import { describe, expect, it } from "vitest";

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
          org: "TunnlAI",
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
  it("handles a very large contract", () => {
    const count = 2000;
    const { run } = timeGateAtScale(count);
    expect(run.status).toBe(0);
    expect(run.envelope.summary.scenariosDeclared).toBe(count);
    expect(run.envelope.summary.traceabilityCovered).toBe(count);
  }, 60_000);
});
