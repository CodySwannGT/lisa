/**
 * Regression tests for the DUPLICATE_ALREADY_FIXED build-intake closeout path.
 *
 * A duplicate whose canonical fix is empirically present on the base branch is
 * terminal work, not a blocked/held ticket. Every vendor scanner must document
 * the narrow auto-close exception while keeping BLOCKED distinct.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const RULE_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;
const BUILD_SKILLS = [
  "github-build-intake",
  "jira-build-intake",
  "linear-build-intake",
] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("build intake duplicate-already-fixed closeout", () => {
  describe.each(ROOTS)("%s ticket-triage", root => {
    const content = readSkill(root, "ticket-triage");

    it("emits a distinct DUPLICATE_ALREADY_FIXED verdict", () => {
      expect(content).toContain("DUPLICATE_ALREADY_FIXED");
      expect(content).toMatch(/canonical ticket reference/i);
      expect(content).toMatch(/empirical evidence/i);
      expect(content).toMatch(/base branch/i);
    });

    it("does not conflate duplicate already fixed with BLOCKED", () => {
      expect(content).toMatch(/duplicate-of-open[\s\S]*BLOCKED/i);
      expect(content).toMatch(
        /DUPLICATE_ALREADY_FIXED[\s\S]*Work MUST NOT proceed/i
      );
    });
  });

  describe.each(ROOTS)("%s tracker-build-intake", root => {
    const content = readSkill(root, "tracker-build-intake");

    it("forwards the duplicate terminal contract to every vendor", () => {
      expect(content).toContain("Duplicate-already-fixed terminal contract");
      expect(content).toMatch(/canonical ticket\/issue reference/i);
      expect(content).toMatch(/canonical PR\/commit reference/i);
      expect(content).toMatch(/empirical evidence/i);
      expect(content).toMatch(/Do not conflate this with `BLOCKED`/);
    });
  });

  describe.each(ROOTS)("%s vendor build-intake skills", root => {
    describe.each(BUILD_SKILLS)("%s", slug => {
      const content = readSkill(root, slug);

      it("documents closeout only for DUPLICATE_ALREADY_FIXED", () => {
        expect(content).toContain("DUPLICATE_ALREADY_FIXED");
        expect(content).toContain("#### 3c.1 Close duplicate already fixed");
        expect(content).toMatch(/canonical .*reference/i);
        expect(content).toMatch(/empirical base-branch evidence/i);
      });

      it("requires duplicate linkage and preserves production-promotion caveat", () => {
        expect(content).toMatch(/duplicates <canonical>/i);
        expect(content).toMatch(
          /production error can recur until the canonical/i
        );
        expect(content).toMatch(/do not reopen this duplicate/i);
      });

      it("keeps BLOCKED and ambiguous outcomes out of auto-close", () => {
        expect(content).toMatch(/distinct from `BLOCKED`/);
        expect(content).toMatch(
          /must not be auto-closed|Auto-close is allowed only/i
        );
      });
    });
  });

  describe.each(RULE_ROOTS)(
    "leaf-only-lifecycle duplicate exception (%s)",
    root => {
      const content = readFileSync(
        path.resolve(root, "leaf-only-lifecycle.md"),
        "utf8"
      );

      it("documents duplicate closeout as a narrow terminal exception", () => {
        expect(content).toMatch(
          /Duplicate closeout is a narrow terminal exception/i
        );
        expect(content).toContain("DUPLICATE_ALREADY_FIXED");
        expect(content).toMatch(/empirical .*base branch/i);
        expect(content).toMatch(/not auto-closed/i);
      });
    }
  );
});
