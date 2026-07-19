/**
 * Contract coverage for the vendor-neutral rejection-detection rule.
 *
 * The eager head + reference body are the executable contract for backward-
 * transition detection at claim time. These assertions pin the classification
 * vocabulary, the config-driven (never hardcoded) lane names, the vendor
 * history bindings, the never-block-the-build degrade, and the no-learning-loops
 * exclusion — and confirm all three build-intake arms cite the ONE shared slug
 * rather than reimplementing detection.
 * @module tests/unit/strategies/rejection-detection-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const BUILD_INTAKES = [
  "lisa-jira-build-intake",
  "lisa-github-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("rejection-detection rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/rejection-detection.md");
    const reference = read(root, "rules/reference/rejection-detection.md");

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/rejection-detection.md](../reference/rejection-detection.md)"
      );
    });

    it("defines the four-way classification vocabulary", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("rejection-reclaim");
        expect(doc).toContain("forward-only");
        expect(doc).toContain("never-left-ready");
        expect(doc).toContain("unknown");
      }
    });

    it("runs at claim time before the relabel", () => {
      expect(eager).toMatch(/before the relabel/i);
      expect(reference).toMatch(/top of `?3b`?/i);
    });

    it("binds all three vendor history sources through the access layers", () => {
      expect(reference).toContain("lisa-github-read-issue");
      expect(reference).toContain("changelog key:<K>");
      expect(reference).toContain("history id:<ID>");
      expect(reference).toMatch(/LabeledEvent/);
    });

    it("sources lane names from config, never hardcoded", () => {
      expect(reference).toContain("github.labels.build");
      expect(reference).toMatch(/never hardcode/i);
      expect(reference).toContain("BUILD_LABEL_DEFAULTS");
    });

    it("never blocks the build (unknown is first-class)", () => {
      expect(reference).toMatch(/never block the build/i);
      expect(reference).toMatch(/unknown.*first-class|first-class result/i);
    });

    it("suppresses the learning-loop trigger at the source", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("[lisa-learning-drop]");
        expect(doc).toContain("[lisa-learning-pr]");
        expect(doc).toContain("[lisa-learning-upstream-handoff]");
        expect(doc).toContain("learning:needs-triage");
      }
    });

    it("every build-intake arm cites the one shared slug at claim time", () => {
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toContain("rejection-detection");
        expect(doc).toMatch(/before the (relabel|transition)/i);
      }
    });
  });
});
