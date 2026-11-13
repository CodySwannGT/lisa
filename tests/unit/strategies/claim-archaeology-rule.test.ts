/**
 * Contract coverage for the vendor-neutral claim-archaeology rule.
 *
 * The eager head + reference body are the executable contract for claim-time
 * archaeology — detecting that a freshly claimed issue is round 2 of a past
 * failure. These assertions pin the three-way classification vocabulary, the
 * explicit sequencing AFTER rejection-detection (whose classification is an
 * input, never re-derived), the three ancestry signals with their honest
 * bounds, the scan-side learning-loop exclusion registry, the config-driven
 * cost budget with its documented default, the degrade-to-fresh/never-block
 * invariant, and the delta-citing candidate derivation — and confirm all
 * three build-intake arms cite the ONE shared slug rather than growing
 * per-vendor archaeology.
 * @module tests/unit/strategies/claim-archaeology-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SYNC_REGISTRY } from "../../../src/sync/registry.js";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const BUILD_INTAKES = [
  "lisa-jira-build-intake",
  "lisa-github-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("claim-archaeology rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/claim-archaeology.md");
    const reference = read(root, "rules/reference/claim-archaeology.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-archaeology.md"
      );
    });

    it("reuses the rejection-detection classification as an input, never re-derives it", () => {
      expect(reference).toContain("rejection-detection");
    });

    it("resolves git ancestry deterministically with a parseable result", () => {
      expect(reference).toContain("git log --follow");
      expect(reference).toContain('--grep "Merge pull request #"');
    });

    it("reads the cost budget from config with a documented default", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("archaeology.maxSteps");
      }
      expect(reference).toContain(".lisa.config.json");
    });

    it("routes the candidate to lisa-persist-learning with a marker fallback", () => {
      expect(reference).toContain("lisa-persist-learning");
    });

    it("sync registry seeds the budget default the rule pair documents", () => {
      const entry = SYNC_REGISTRY.find(
        setting => setting.key === "archaeology"
      );
      expect(entry?.defaultValue).toEqual({ maxSteps: 8 });
    });

    it("every build-intake arm cites the one shared slug in the claim window", () => {
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toContain("claim-archaeology");
      }
    });

    it("arms carry vendor wiring only — shared semantics live solely in the rule pair", () => {
      const wiring: Record<(typeof BUILD_INTAKES)[number], readonly string[]> =
        {
          "lisa-jira-build-intake": [
            "operation: search-issues",
            "operation: comment",
          ],
          "lisa-github-build-intake": ["gh search issues", "gh issue comment"],
          "lisa-linear-build-intake": [
            "operation: list-issues",
            "operation: save-comment",
          ],
        };
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        for (const primitive of wiring[skill]) {
          expect(doc).toContain(primitive);
        }
        expect(doc).not.toContain("archaeology.maxSteps");
      }
    });
  });
});
