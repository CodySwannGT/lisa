/**
 * Regression tests for the reported findings about how the gate READS the
 * repository (CodySwannGT/lisa#2468, section A: #6, #7, #8).
 *
 * Each case is a repository the gate previously mis-read: an unparsable base
 * revision, a path prefix that matched half a directory name, and a feature
 * file whose steps live in a `Background:`.
 *
 * @module tests/unit/scripts/bdd-gate-paths
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_ID,
  HOME_SPEC,
  PLAYWRIGHT,
  PLAYWRIGHT_DISCOVERY,
  RATIFIED,
  WEB,
  codes,
  commitAll,
  healthyProject,
  runGate,
  writeMap,
} from "./bdd/support";

/**
 * A one-feature file whose Background carries some of the primary steps.
 * @param steps - The scenario's own steps, after the Background's Given.
 * @returns Gherkin source.
 */
function withBackground(steps: readonly string[]): string {
  return [
    "Feature: Background",
    "",
    "  Background:",
    "    Given a signed-in visitor",
    "",
    `  @${HOME_ID} @${WEB} @${RATIFIED}`,
    "  Scenario: acts",
    ...steps.map(step => `    ${step}`),
    "",
  ].join("\n");
}

/**
 * A project whose only feature file is the supplied Background fixture.
 * @param steps - The scenario's own steps.
 * @returns Project root.
 */
function backgroundProject(steps: readonly string[]): string {
  const root = healthyProject(
    {},
    { features: { "background.feature": withBackground(steps) } }
  );
  fs.rmSync(path.join(root, "bdd", "features", "home.feature"));
  return root;
}

describe("bdd gate: repository-reading findings (lisa#2468)", () => {
  describe("#6 an unreadable base coverage map fails closed", () => {
    it("reports a baseline defect rather than an empty comparison", () => {
      const root = healthyProject();
      fs.writeFileSync(
        path.join(root, "bdd", "coverage-map.json"),
        "{ this is not json"
      );
      const baseSha = commitAll(root);
      writeMap(root, HEALTHY_MAP);
      const run = runGate(root, { BDD_BASE_SHA: baseSha });
      expect(codes(run)).toContain("baseline");
    });
  });

  describe("#7 path prefixes match whole segments", () => {
    it("an ignore prefix of e2e/live does not swallow e2e/live-personas", () => {
      const root = healthyProject(
        {
          testDiscovery: {
            [PLAYWRIGHT]: { ...PLAYWRIGHT_DISCOVERY, ignore: ["e2e/live"] },
          },
        },
        {
          files: {
            "e2e/live-personas/persona.spec.ts": `test("undeclared persona flow", async () => {});\n`,
          },
        }
      );
      const run = runGate(root);
      expect(codes(run)).toContain("spec-undisclosed");
    });

    it("still honours an ignore prefix that really does cover the file", () => {
      const root = healthyProject(
        {
          testDiscovery: {
            [PLAYWRIGHT]: { ...PLAYWRIGHT_DISCOVERY, ignore: ["e2e/live"] },
          },
        },
        {
          files: {
            "e2e/live/persona.spec.ts": `test("ignored live flow", async () => {});\n`,
          },
        }
      );
      const run = runGate(root);
      expect(codes(run)).not.toContain("spec-undisclosed");
    });

    it("a discovery root of . covers every repo-relative exclusion", () => {
      const root = healthyProject({
        testDiscovery: {
          [PLAYWRIGHT]: { ...PLAYWRIGHT_DISCOVERY, roots: ["."] },
        },
        mappings: [],
        exclusions: [
          {
            file: HOME_SPEC,
            evidence: HOME_EVIDENCE,
            reason: "smoke check, aligned to no product behavior",
          },
        ],
      });
      const run = runGate(root);
      expect(codes(run)).not.toContain("exclusion-stale");
    });

    it("still reports an exclusion no configured root covers", () => {
      const root = healthyProject({
        mappings: [],
        exclusions: [
          {
            file: "somewhere-else/other.spec.ts",
            evidence: HOME_EVIDENCE,
            reason: "not under any declared root",
          },
        ],
      });
      const run = runGate(root);
      expect(codes(run)).toContain("exclusion-stale");
    });
  });

  describe("#8 Background steps count toward a scenario's primary steps", () => {
    it("does not report a missing Given that Background supplies", () => {
      const root = backgroundProject([
        "When they act",
        "Then something is true",
      ]);
      expect(codes(runGate(root))).not.toContain("scenario-steps");
    });

    it("still reports a step no Background and no scenario supplies", () => {
      const root = backgroundProject(["When they act"]);
      expect(codes(runGate(root))).toContain("scenario-steps");
    });
  });
});
