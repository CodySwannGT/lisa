/**
 * Contract coverage for the vendor-neutral design-source-of-truth rule (WU-F,
 * issue #2430).
 *
 * The gap this rule closes is narrow and easy to re-lose: every other Lisa
 * design obligation only fires when a design artifact already exists, so UI
 * invented straight into code was governed by nothing. These assertions pin the
 * three things most likely to rot — the exact marker spelling (a drifted marker
 * silently disarms the gate), the fail-closed wording (the moment it reads as
 * advisory it stops being a gate), and the deference to host design-system
 * rules (this contract governs *whether the source is declared*, never *what to
 * build*, which is the host's call).
 * @module tests/unit/strategies/design-source-of-truth-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The exact marker. Hardcoded, never imported — drift is the thing under test. */
const MARKER = "DESIGN-SOURCE: none — not in Figma";

/** Host design-system rule files this contract must defer to, not replace. */
const HOST_RULES = [
  "figma-design-system",
  "design-system",
  "use-the-design-library",
] as const;

/** Every skill wired to cite the contract rather than restate it. */
const CITING_SKILLS = [
  "lisa-implement",
  "lisa-tdd-implementation",
  "lisa-review-local",
  "lisa-quality-review",
  "lisa-tracker-source-artifacts",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("design-source-of-truth rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/design-source-of-truth.md");
    const reference = read(root, "rules/reference/design-source-of-truth.md");

    it("documents the explicit opt-out without exempting design-value binding", () => {
      expect(reference).toContain("designSource.enabled");
      expect(reference).toContain("SKIPPED: designSource.enabled=false");
      expect(reference).toContain("design-value-binding");
    });

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/design-source-of-truth.md"
      );
    });

    it("carries the exact marker spelling on both sides", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain(MARKER);
      }
    });

    it("names the positive annotation form alongside the exception", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("DESIGN-SOURCE: <figma-url>");
      }
    });

    it("defers to host design-system rules instead of contradicting them", () => {
      for (const hostRule of HOST_RULES) {
        expect(reference).toContain(hostRule);
      }
    });

    it("cites sibling rules and consumer skills by bare slug", () => {
      expect(eager).toContain("tool-access-gate");
      expect(eager).toContain("bdd-e2e-coverage");
      for (const skill of CITING_SKILLS) {
        expect(eager).toContain(skill);
      }
      expect(eager).not.toContain("rules/reference/tool-access-gate.md");
    });

    it("names the gate script so the contract is executable, not advisory", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("design-source-gate.mjs");
      }
    });
  });

  describe.each(ROOTS)("%s consumers", root => {
    it.each(CITING_SKILLS)("%s cites the contract by slug", skill => {
      expect(read(root, `skills/${skill}/SKILL.md`)).toContain(
        "design-source-of-truth"
      );
    });

    it.each(CITING_SKILLS)(
      "%s omits provenance work only on explicit false",
      skill => {
        const consumer = read(root, `skills/${skill}/SKILL.md`);
        expect(consumer).toContain("designSource.enabled");
      }
    );

    it("the review path runs the gate and treats a FAIL as blocking", () => {
      const reviewLocal = read(root, "skills/lisa-review-local/SKILL.md");
      expect(reviewLocal).toContain("design-source-gate.mjs");
    });

    it("the implement path prefers sync-back before reaching for the marker", () => {
      const implement = read(root, "skills/lisa-implement/SKILL.md");
      expect(implement).toContain(MARKER);
    });

    it("source-artifacts points its divergence note at the code-side contract", () => {
      expect(
        read(root, "skills/lisa-tracker-source-artifacts/SKILL.md")
      ).toContain("design-source-of-truth");
    });

    it("ships the gate script in the plugin so every agent can run it", () => {
      expect(read(root, "scripts/design-source-gate.mjs")).toContain(MARKER);
    });
  });
});
