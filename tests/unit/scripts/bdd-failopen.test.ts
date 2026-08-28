/**
 * Regressions for six ways the gate could report something it had not proven.
 *
 * Every case here is a hole found by review AFTER the gate shipped, and each
 * one failed in the same direction: the number looked better than the repo
 * was. A gate whose whole purpose is to stop a manifest lying cannot itself
 * round in the flattering direction.
 */
import { describe, expect, it } from "vitest";

import {
  FLOOR_INVALID,
  HEALTHY_FILES,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_FEATURE_FILE,
  HOME_ID,
  HOME_SPEC,
  PLAYWRIGHT,
  RATIFIED,
  WEB,
  codes,
  commitAll,
  featureSource,
  healthyMapping,
  healthyProject,
  makeProject,
  messages,
  readMap,
  runGate,
  runGateWrite,
  runReport,
  writeMap,
} from "./bdd/support";

const RESULTS_FILE = "results.json";
const STALE_TITLE = "renamed away";
const STALE_SOURCE = `test("${STALE_TITLE}", async () => {});\n`;

describe("a malformed coverage floor cannot disable the floor", () => {
  it("refuses a floor quoted as a string", () => {
    const run = runGate(healthyProject({ coverageFloor: { [WEB]: "100" } }));
    expect(run.status).toBe(1);
    expect(messages(run, FLOOR_INVALID)[0]).toContain(
      "silently disables enforcement"
    );
  });

  it("refuses NaN, null, and out-of-range floors", () => {
    // The whole exploit is a one-character edit in one file, and there is no
    // longer any state in which it is graded as a warning.
    for (const bad of [null, Number.NaN, -1, 101, true]) {
      const run = runGate(healthyProject({ coverageFloor: { [WEB]: bad } }));
      expect(run.status, String(bad)).toBe(1);
      expect(codes(run), String(bad)).toContain(FLOOR_INVALID);
    }
  });

  it("still refuses a floor quoted AFTER it was a number, with a base to compare", () => {
    // This case used to be caught by the floor ratchet's base comparison,
    // which read an unusable head value as a removal. The ratchet is gone and
    // the hole is not: `floor-invalid` fires on the head value alone, so it
    // does not depend on a base revision being available.
    const root = healthyProject({ coverageFloor: { [WEB]: 100 } });
    const base = commitAll(root);
    const map = readMap(root);
    (map.coverageFloor as Record<string, unknown>)[WEB] = "100";
    writeMap(root, map);
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    expect(messages(run, FLOOR_INVALID)[0]).toContain(
      "silently disables enforcement"
    );
  });

  it("never reports a platform as clearing a floor it cannot evaluate", () => {
    const report = runReport(
      healthyProject({ coverageFloor: { [WEB]: "100" } })
    );
    expect(report.floor.byPlatform[WEB]).toMatchObject({
      state: "invalid",
      ok: false,
    });
    expect(report.floor.ok).toBe(false);
  });
});

describe("a stale mapping stops counting as covered", () => {
  it("excludes an unresolved evidence string from traceability", () => {
    // Two separate facts, and the second is the one that bit a fleet fork: the
    // mapping is REPORTED as broken, and it also stops COUNTING. If it still
    // counted, the headline would keep claiming coverage for a test that no
    // longer exists.
    const root = makeProject({
      map: {
        ...HEALTHY_MAP,
        coverageFloor: { [WEB]: 0 },
      },
      features: {
        [HOME_FEATURE_FILE]: featureSource("Home", [
          { id: HOME_ID, tags: [WEB, RATIFIED] },
        ]),
      },
      files: {
        [HOME_SPEC]: `test("a completely different title", () => {});\n`,
      },
    });
    const run = runGate(root);
    expect(codes(run)).toContain("mapping-evidence");
    expect(run.status).toBe(1);
    expect(run.envelope.summary.traceabilityCovered).toBe(0);
    expect(run.envelope.summary.traceabilityTotal).toBe(1);
  });

  it("still counts a mapping whose evidence resolves", () => {
    const run = runGate(healthyProject());
    expect(run.envelope.summary.traceabilityCovered).toBe(1);
  });

  it("keeps an obligation covered when another aligned mapping still resolves", () => {
    const root = healthyProject({
      mappings: [
        healthyMapping(),
        { ...healthyMapping(), evidence: "renamed supplemental test" },
      ],
    });
    const run = runGate(root);
    expect(codes(run)).toContain("mapping-evidence");
    expect(run.envelope.summary.traceabilityCovered).toBe(1);
    expect(run.envelope.summary.traceabilityTotal).toBe(1);
  });

  it("lists the now-uncovered obligation as a gap", () => {
    const report = runReport(
      healthyProject(
        {},
        { files: { [HOME_SPEC]: "test('renamed', () => {});\n" } }
      )
    );
    expect(report.gaps.map(gap => gap.scenario)).toContain(HOME_ID);
  });

  it("still lets --write regenerate the artifacts that document it", () => {
    // A renamed title once wedged regeneration entirely in a fleet fork, so a
    // waiver could not be recorded until an unrelated string was repaired.
    const root = healthyProject({}, { files: { [HOME_SPEC]: STALE_SOURCE } });
    expect(runGateWrite(root)).toContain(STALE_TITLE);
    expect(runGate(root).status).toBe(1);
  });
});

describe("Gherkin feature-level tags are inherited", () => {
  /**
   * Build a feature whose platform and provenance tags sit on `Feature:`.
   * @returns Gherkin source.
   */
  function inheritedSource(): string {
    return (
      `@${WEB} @${RATIFIED}\nFeature: Home\n\n` +
      `  @${HOME_ID}\n  Scenario: A visitor sees the hero\n` +
      `    Given a visitor\n    When they act\n    Then something is true\n`
    );
  }

  it("does not report inherited @web / @ratified-* as missing", () => {
    const root = makeProject({
      map: { ...HEALTHY_MAP, coverageFloor: { [WEB]: 0 } },
      features: { [HOME_FEATURE_FILE]: inheritedSource() },
      files: HEALTHY_FILES,
    });
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(codes(run)).not.toContain("scenario-platform");
    expect(codes(run)).not.toContain("scenario-provenance");
    expect(run.status).toBe(0);
  });

  it("counts the obligation the inherited platform creates", () => {
    const root = makeProject({
      map: { ...HEALTHY_MAP, coverageFloor: { [WEB]: 0 } },
      features: { [HOME_FEATURE_FILE]: inheritedSource() },
      files: HEALTHY_FILES,
    });
    expect(runGate(root).envelope.summary).toMatchObject({
      traceabilityTotal: 1,
      traceabilityCovered: 1,
    });
  });

  it("refuses a scenario ID placed on the Feature", () => {
    // Inheriting it would hand every scenario in the file the same identity.
    const source =
      `@${HOME_ID}\nFeature: Home\n\n` +
      `  @${WEB} @${RATIFIED}\n  Scenario: One\n    Given a\n    When b\n    Then c\n\n` +
      `  @${WEB} @${RATIFIED}\n  Scenario: Two\n    Given a\n    When b\n    Then c\n`;
    const run = runGate(
      makeProject({
        map: { ...HEALTHY_MAP, mappings: [], coverageFloor: { [WEB]: 0 } },
        features: { [HOME_FEATURE_FILE]: source },
        files: HEALTHY_FILES,
      })
    );
    expect(messages(run, "scenario-id").join(" ")).toContain("on the Feature");
  });

  it("lets a scenario's own lifecycle tag apply alongside inherited tags", () => {
    const source =
      `@${WEB} @${RATIFIED}\nFeature: Home\n\n` +
      `  @${HOME_ID} @blocked\n  Scenario: Not built yet\n    Given a\n    When b\n    Then c\n`;
    const report = runReport(
      makeProject({
        map: { ...HEALTHY_MAP, mappings: [], coverageFloor: { [WEB]: 0 } },
        features: { [HOME_FEATURE_FILE]: source },
        files: HEALTHY_FILES,
      })
    );
    expect(report.scenarios).toMatchObject({
      declared: 1,
      required: 0,
      blocked: 1,
    });
  });
});

describe("a duplicate execution result never buries a failure", () => {
  /**
   * Two runs reporting the same test with different statuses.
   * @param first - Status reported by the first run.
   * @param second - Status reported by the second run.
   * @returns Serialized result documents.
   */
  function twoRuns(first: string, second: string): string {
    return JSON.stringify([
      {
        schemaVersion: 1,
        runner: PLAYWRIGHT,
        runId: "shard-1",
        results: [{ file: HOME_SPEC, evidence: HOME_EVIDENCE, status: first }],
      },
      {
        schemaVersion: 1,
        runner: PLAYWRIGHT,
        runId: "shard-2",
        results: [{ file: HOME_SPEC, evidence: HOME_EVIDENCE, status: second }],
      },
    ]);
  }

  it("keeps the failure whichever order the shards report in", () => {
    for (const [first, second] of [
      ["failed", "passed"],
      ["passed", "failed"],
    ] as const) {
      const root = healthyProject(
        {},
        { files: { [RESULTS_FILE]: twoRuns(first, second) } }
      );
      const run = runGate(root, {
        BDD_EXECUTION_RESULTS: RESULTS_FILE,
      });
      expect(run.envelope.summary, `${first}->${second}`).toMatchObject({
        failed: 1,
        passed: 0,
        executed: 1,
      });
    }
  });

  it("ranks skipped above passed so a skip is not hidden either", () => {
    const root = healthyProject(
      {},
      { files: { [RESULTS_FILE]: twoRuns("skipped", "passed") } }
    );
    expect(
      runGate(root, { BDD_EXECUTION_RESULTS: RESULTS_FILE }).envelope.summary
    ).toMatchObject({ skipped: 1, passed: 0 });
  });

  it("treats an unrecognized status as most severe rather than letting a pass win", () => {
    const root = healthyProject(
      {},
      { files: { [RESULTS_FILE]: twoRuns("passed", "timed-out") } }
    );
    const summary = runGate(root, {
      BDD_EXECUTION_RESULTS: RESULTS_FILE,
    }).envelope.summary;
    expect(summary.passed).toBe(0);
    expect(summary.executed).toBe(1);
  });
});

describe("an empty denominator is not 100%", () => {
  it("reports percentage null rather than a fabricated 100", () => {
    const report = runReport(
      makeProject({
        map: {
          ...HEALTHY_MAP,
          runnerPlatforms: { [PLAYWRIGHT]: [WEB], maestro: ["ios"] },
          coverageFloor: { [WEB]: 0, ios: 0 },
        },
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED] },
          ]),
        },
        files: HEALTHY_FILES,
      })
    );
    expect(report.traceability.byPlatform.ios).toMatchObject({
      total: 0,
      percentage: null,
    });
  });

  it("a positive floor is never cleared by having nothing to measure", () => {
    const report = runReport(
      makeProject({
        map: {
          ...HEALTHY_MAP,
          runnerPlatforms: { [PLAYWRIGHT]: [WEB], maestro: ["ios"] },
          coverageFloor: { [WEB]: 0, ios: 80 },
        },
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED] },
          ]),
        },
        files: HEALTHY_FILES,
      })
    );
    expect(report.floor.byPlatform.ios.ok).toBe(false);
  });
});
