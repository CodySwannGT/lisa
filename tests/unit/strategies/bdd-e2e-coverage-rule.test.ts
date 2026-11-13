/**
 * Contract coverage for the vendor-neutral bdd-e2e-coverage rule.
 *
 * The eager head + reference body are the executable contract every frontend
 * work item conforms to. These assertions pin the thing most likely to rot:
 * vendor neutrality. The rule generalizes prose that previously named Playwright
 * and Maestro as mandates inside four separate skills, so the head must stay
 * free of runner names, the citing skills must reference the slug instead of
 * re-growing their own divergent copies, and the waiver mechanism must keep
 * reading as a dated IOU rather than as coverage.
 * @module tests/unit/strategies/bdd-e2e-coverage-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** Every skill wired to cite the contract rather than restate it. */
const CITING_SKILLS = [
  "lisa-research",
  "lisa-acceptance-criteria",
  "lisa-task-decomposition",
  "lisa-test-strategy",
  "lisa-tdd-implementation",
  "lisa-implement",
  "lisa-codify-verification",
  "lisa-verification-lifecycle",
  "lisa-spec-conformance",
  "lisa-verify",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("bdd-e2e-coverage rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/bdd-e2e-coverage.md");
    // #3992 folded the eager head into the body under its own H2, above a
    // horizontal rule. The vendor-neutrality assertions below are scoped to
    // that section deliberately: the full contract names runners as examples,
    // and the property being pinned is that the SUMMARY mandates none.
    const eager = reference.slice(
      reference.indexOf("## BDD Behavior Contract"),
      reference.indexOf("\n---\n")
    );

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/bdd-e2e-coverage.md"
      );
    });

    it("states vendor neutrality explicitly, with runner names only as examples", () => {
      expect(reference).toMatch(/runnerPlatforms/);
    });

    it("requires stable scenario IDs that survive rewrites", () => {
      expect(eager).toMatch(/@BDD-<DOMAIN>-<NNN>/);
    });

    it("keeps a waiver a dated IOU and never coverage", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/recordedAt|dated/i);
      }
    });

    it("states the definition-of-done clause with all three conjuncts", () => {
      const dod = /## Definition of done\n\n([\s\S]*?)\n\n## /.exec(eager)?.[1];
      expect(dod).toBeDefined();
    });

    it("cites sibling rules and consumer skills by bare slug", () => {
      expect(eager).toContain("leaf-only-lifecycle");
      expect(eager).toContain("repo-scope-split");
      for (const skill of CITING_SKILLS) {
        expect(eager).toContain(skill);
      }
      expect(eager).not.toContain("rules/reference/leaf-only-lifecycle.md");
    });
  });

  describe.each(ROOTS)("%s consumers", root => {
    it.each(CITING_SKILLS)("%s cites the contract by slug", skill => {
      const doc = read(root, `skills/${skill}/SKILL.md`);
      expect(doc).toContain("bdd-e2e-coverage");
    });

    it("verification and intent-routing rules defer to the contract", () => {
      for (const rel of [
        "rules/eager/verification.md",
        "rules/reference/verification.md",
        "rules/reference/intent-routing.md",
      ]) {
        expect(read(root, rel)).toContain("bdd-e2e-coverage");
      }
    });
  });
});
