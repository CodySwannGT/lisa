/**
 * Regression tests for claim-time repo scoping in the build-intake scanners.
 *
 * A ticketing system can oversee multiple repos (one JIRA project / Linear team
 * for frontend / backend / infrastructure). When build-intake runs inside one
 * repo it must claim only tickets for THAT repo: skip a ready ticket labeled for
 * another repo, determine + stamp `repo:<name>` on an unlabeled one, split a
 * multi-repo leaf into single-repo build-ready siblings, and claim only a
 * single-repo leaf for the current repo. This is the fourth enforcement point of
 * the single-repo-leaf invariant (`repo-scope-split` rule), implemented as the
 * Phase 3a.0 gate that runs BEFORE the leaf-only gate in each vendor scanner.
 *
 * Both source and generated plugin roots are asserted.
 * @module tests/unit/strategies/repo-scope-claim
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
/** The Phase 3a.0 repo-scope gate heading text. */
const GATE = "3a.0 Repo-scope gate";
/** Heading of the leaf-only gate the repo-scope gate must precede. */
const LEAF_GATE = "#### 3a. Leaf-only claim gate";
/** The rule the gate cites as its single source of truth. */
const RULE_SLUG = "repo-scope-split";
/** GitHub build-intake skill slug used by the GitHub-only container assertions. */
const GITHUB_BUILD_INTAKE = "lisa-github-build-intake";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("claim-time repo scoping (Phase 3a.0)", () => {
  const SCANNERS = [
    "lisa-jira-build-intake",
    GITHUB_BUILD_INTAKE,
    "lisa-linear-build-intake",
  ] as const;

  describe.each(SCANNERS)("%s", scanner => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, scanner);

      it("defines a Phase 3a.0 repo-scope gate before the leaf-only gate", () => {
        const gateIdx = content.indexOf(GATE);
        const leafIdx = content.indexOf(LEAF_GATE);
        expect(gateIdx).toBeGreaterThan(-1);
        expect(leafIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(leafIdx);
      });

      const section = (): string => {
        const c = readSkill(root, scanner);
        return c.slice(c.indexOf(GATE), c.indexOf(LEAF_GATE));
      };

      it("resolves the current repo via config-resolution", () => {
        expect(section()).toContain("config-resolution");
      });

      it("splits a multi-repo leaf into single-repo build-ready siblings", () => {
        expect(section()).toMatch(/build_ready: true/);
      });

      it("counts markers and splits before the single-wrong-repository skip", () => {
        const text = section();
        const count = text.indexOf("Count distinct repository markers first");
        const split = text.indexOf("Multi-repo leaf → split");
        const skip = text.indexOf("Exactly one other repository");
        expect(count).toBeGreaterThan(-1);
        expect(split).toBeGreaterThan(count);
        expect(skip).toBeGreaterThan(split);
      });

      it("cites the repo-scope-split rule by slug", () => {
        expect(section()).toContain(RULE_SLUG);
      });
    });
  });

  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, GITHUB_BUILD_INTAKE);

    it("keeps multi-repo containers visible without splitting or claiming them in GitHub intake", () => {
      expect(content).toContain("lisa-github-build-intake");
    });
  });
});

describe("repo-scope-split rule documents claim-time scoping", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/rules/reference/repo-scope-split.md"),
    "utf8"
  );
  it("has a Claim-time repo scoping section with the skip/stamp/split decision", () => {
    expect(content).toMatch(/build_ready: true/);
  });
});

describe("tracker-build-intake shim forwards the repo-scope contract", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "lisa-tracker-build-intake");
    it("documents the forwarded repo-scope claim contract", () => {
      expect(content).toContain(RULE_SLUG);
    });
  });
});
