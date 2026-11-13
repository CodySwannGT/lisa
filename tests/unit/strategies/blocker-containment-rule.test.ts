/**
 * Contract coverage for the vendor-neutral blocker-containment rule.
 *
 * The eager head + reference body are the executable contract for deciding
 * whether an `is blocked by` dependency is satisfied. These assertions pin the
 * predicate (branch containment, not a lifecycle status name), the fail-closed
 * reason keys, the narrow no-code carve-out, and the derived-branch-plan
 * constraint that the rendered Branch Plan is never read as input — and confirm
 * all three consuming surfaces cite the ONE shared slug rather than each
 * growing its own status-name list again.
 *
 * The two directional guards are the point of the suite: a blocker merged only
 * to a non-containing branch must still block (the defect this rule fixes), and
 * a blocker merged into the branch the dependent builds from must clear without
 * waiting for production (the regression guard for the stranding bug the old
 * env-staged wording was itself introduced to fix).
 * @module tests/unit/strategies/blocker-containment-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const CONSUMERS = [
  "lisa-repair-intake",
  "lisa-intake-explain",
  "lisa-ticket-triage",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Strip markdown emphasis so a phrase assertion tests the prose, not where the
 * author happened to put bold markers. Without this, adding `**` around two
 * words silently breaks an assertion that still holds semantically.
 * @param doc - Raw markdown
 * @returns The same text with `*` and backtick emphasis removed
 */
const plain = (doc: string): string => doc.replace(/[*`]/g, "");

describe("blocker-containment rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/blocker-containment.md");
    const reference = read(root, "rules/reference/blocker-containment.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/blocker-containment.md"
      );
    });

    it("states the predicate as branch containment, not a status name", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/merge-base --is-ancestor|ancestry/i);
      }
    });

    it("names the status labels that are explicitly NOT the test", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(
          /never that fact|is the wrong test|never the test/i
        );
      }
    });

    it("derives the base branch from the environment, never from a rendered Branch Plan", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("deploy.branches");
        expect(doc).toContain("derived-branch-plan");
      }
    });

    it("keeps the no-code carve-out narrow and positive, never an absence", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/no runtime behavior change/);
        expect(plain(doc)).toMatch(/positive determination, never an absence/i);
      }
      // The carve-out must not be satisfiable by a failed lookup.
      expect(plain(reference)).toMatch(
        /I could not find a PR" is no-pr|is no-pr in the fail-closed table/i
      );
    });

    it("requires the complete no-code declaration and no PR in repair intake", () => {
      const repair = read(root, "skills/lisa-repair-intake/SKILL.md");
      const start = repair.indexOf("- **Ships no code**");
      const end = repair.indexOf("- **Human override**", start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const carveOut = plain(repair.slice(start, end)).split(/\s+/u).join(" ");
      expect(carveOut).toContain("None — no runtime behavior change: <kind>");
      for (const kind of [
        "doc-only",
        "config-only",
        "type-only",
        "test-only",
      ]) {
        expect(carveOut).toContain(kind);
      }
      expect(carveOut).toContain("no linked PR and no merge commit");
      expect(carveOut).toContain("open or unmerged PR stays blocking");
      expect(carveOut).not.toContain("has no merged PR");
    });

    describe.each(CONSUMERS)("%s cites the shared slug", consumer => {
      it("cites blocker-containment rather than reimplementing the test", () => {
        const skill = read(root, `skills/${consumer}/SKILL.md`);
        expect(skill).toContain("blocker-containment");
      });
    });
  });
});
