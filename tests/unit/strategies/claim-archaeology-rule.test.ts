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
    const eager = read(root, "rules/eager/claim-archaeology.md");
    const reference = read(root, "rules/reference/claim-archaeology.md");

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/claim-archaeology.md](../reference/claim-archaeology.md)"
      );
    });

    it("defines the three-way classification vocabulary", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("fresh");
        expect(doc).toContain("retry-of-done-issue");
        expect(doc).toContain("rejection-reclaim");
      }
    });

    it("sequences explicitly after rejection detection, before the claim transition", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/after (the )?rejection[- ]detection/i);
        expect(doc).toMatch(/before the (relabel|transition|claim)/i);
      }
    });

    it("reuses the rejection-detection classification as an input, never re-derives it", () => {
      expect(reference).toContain("rejection-detection");
      expect(reference).toMatch(/reuse[sd]?.*not re-deriv|never re-deriv/i);
      expect(eager).toMatch(/input/i);
    });

    it("names the tracker-metadata signal via the typed relations the read skills parse", () => {
      expect(reference).toContain("Blocks");
      expect(reference).toContain("Blocked by");
      expect(reference).toContain("Relates to");
      expect(reference).toContain("Duplicates");
      expect(reference).toContain("Cloned from");
      expect(reference).toContain("closingIssuesReferences");
      expect(reference).toMatch(/cross-referenc/i);
    });

    it("scopes text similarity honestly to tracker search primitives, no embeddings", () => {
      expect(reference).toContain("gh search issues");
      expect(reference).toContain("search-issues");
      expect(reference).toContain("list-issues");
      expect(reference).toMatch(/recently[- ]closed/i);
      expect(reference).toMatch(/no embedding|not semantic|lexical/i);
      expect(reference).toMatch(/title.*label overlap|title\/label overlap/i);
    });

    it("resolves git ancestry deterministically with a parseable result", () => {
      expect(reference).toContain("git log --follow");
      expect(reference).toContain("git blame");
      expect(reference).toContain('--grep "Merge pull request #"');
      expect(reference).toMatch(/\{\s*file,\s*sha,\s*pr,\s*date\s*\}/);
      expect(reference).toMatch(
        /git-history-analyzer.*(prose|no machine|never|not)/is
      );
    });

    it("excludes the flow's own learning artifacts from ancestry (scan-side registry)", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("[lisa-learning-drop]");
        expect(doc).toContain("[lisa-learning-pr]");
        expect(doc).toContain("[lisa-learning-upstream-handoff]");
        expect(doc).toContain("[lisa-rejection-candidate]");
        expect(doc).toContain("[lisa-archaeology-candidate]");
        expect(doc).toContain("learning:needs-triage");
      }
      expect(reference).toMatch(/never an ancestor/i);
    });

    it("degrades to fresh and never blocks the claim", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/never blocks? the (claim|build)/i);
        expect(doc).toMatch(/degrade[sd]? to `?fresh`?/i);
      }
      expect(reference).toMatch(/exception|throws|errors/i);
      expect(reference).toMatch(/claim (still )?proceeds/i);
    });

    it("reads the cost budget from config with a documented default", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("archaeology.maxSteps");
      }
      expect(reference).toContain(".lisa.config.json");
      expect(reference).toContain("jq");
      expect(reference).toMatch(/default[^.]*8/i);
      expect(reference).toMatch(
        /single documented place|one documented place/i
      );
    });

    it("derives the retry candidate from the delta, not a vague summary", () => {
      expect(reference).toMatch(/delta/i);
      expect(reference).toMatch(/what was done.*what.*(needed|required)/is);
      expect(reference).toMatch(/vague summary/i);
      expect(reference).toMatch(/review threads/i);
      expect(reference).toMatch(/evidence comments/i);
    });

    it("routes the candidate to lisa-persist-learning with a marker fallback", () => {
      expect(reference).toContain("lisa-persist-learning");
      expect(reference).toMatch(/key=<issue>::<ancestor>/);
      expect(reference).toMatch(/visible prose/i);
      expect(reference).toMatch(
        /Recorded a candidate learning from this retry/
      );
    });

    it("is idempotent — re-claims produce no duplicate candidate", () => {
      expect(reference).toMatch(/no duplicate|never.*duplicate/i);
      expect(reference).toMatch(/stateless/i);
    });

    it("a fresh classification produces no candidate and zero comments", () => {
      expect(reference).toMatch(/no candidate/i);
      expect(reference).toMatch(/zero comments|no comment/i);
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
        expect(doc).toMatch(/after rejection detection/i);
        expect(doc).toContain("[lisa-archaeology-candidate]");
        expect(doc).toContain("archaeology.maxSteps");
        expect(doc).toMatch(/degrade[sd]? to `?fresh`?/i);
        expect(doc).toMatch(/never blocks? the (claim|build)/i);
      }
    });
  });
});
