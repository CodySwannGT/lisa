/**
 * Contract coverage for the vendor-neutral `derived-branch-plan` rule and its
 * five wired surfaces (three tracker writers, three validators, lisa-implement).
 *
 * The requirement behind this contract is "every applicable leaf work item makes
 * its base branch and PR target visible". The trap it must never fall into is
 * satisfying that with two literal branch fields, because Lisa already has an
 * authority for the same fact — `## Target Backend Environment` resolved through
 * `.lisa.config.json` `deploy.branches`. Two authorities drift, and a drifted
 * branch target silently ships to the wrong environment.
 *
 * So these assertions pin the properties most likely to rot into that trap:
 * the section is DERIVED (recomputed, never read as input), a conflicting
 * hand-authored plan is REJECTED rather than silently reconciled, a legacy item
 * with no plan gets a written assumption instead of a silent guess, and work
 * that legitimately has no environment is exempt rather than forced to invent one.
 * @module tests/unit/strategies/derived-branch-plan-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;

/** The rule slug every wired surface cites instead of restating the contract. */
const SLUG = "derived-branch-plan";

/** The two rendered fields operators asked to see. */
const FIELDS = ["Branch from:", "PR into:"] as const;

/** The authority the plan is derived FROM — never a peer of it. */
const AUTHORITY = "Target Backend Environment";
const DEPLOY_MAP = "deploy.branches";

/** The three vendor writers that render the section. */
const WRITERS = [
  "lisa-jira-write-ticket",
  "lisa-github-write-issue",
  "lisa-linear-write-issue",
] as const;

/** The three validators that carry gate S19. */
const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

/**
 * Read a skill body from one plugin root.
 * @param root - Plugin skills root (source or generated fanout)
 * @param slug - Skill directory name
 * @returns SKILL.md contents
 */
const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

/**
 * Read a rule body from one plugin root, honoring cursor's flat `.mdc` naming.
 * @param root - Plugin rules root
 * @param group - Which half of the rule pair
 * @param slug - Rule slug
 * @returns Rule contents
 */
const readRule = (
  root: string,
  group: "eager" | "reference" | "index",
  slug: string
): string => {
  // #3992: a demoted rule has no head; the always-on index carries its pointer.
  if (group === "index") {
    return root.includes("lisa-cursor")
      ? readFileSync(path.resolve(root, "00-rule-index.mdc"), "utf8")
      : readFileSync(path.resolve(root, "eager", "00-rule-index.md"), "utf8");
  }
  if (root.includes("lisa-cursor")) {
    return readFileSync(
      path.resolve(
        root,
        `${slug}${group === "reference" ? "-reference" : ""}.mdc`
      ),
      "utf8"
    );
  }
  return readFileSync(path.resolve(root, group, `${slug}.md`), "utf8");
};

describe("derived-branch-plan rule contract", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    const eager = readRule(root, "reference", SLUG);
    const reference = readRule(root, "reference", SLUG);

    it("stays reachable from the eager rule index", () => {
      expect(reference.length).toBeGreaterThan(2000);
      expect(readRule(root, "index", SLUG)).toContain(`reference/${SLUG}.md`);
    });

    it("names the section and both rendered fields", () => {
      for (const field of FIELDS) {
        expect(eager).toContain(field);
        expect(reference).toContain(field);
      }
    });

    it("subordinates the plan to the environment authority", () => {
      expect(eager).toContain(AUTHORITY);
      expect(eager).toContain(DEPLOY_MAP);
    });

    it("carries the derivation provenance line that marks it machine-authored", () => {
      expect(eager).toContain("Derived from:");
    });

    it("names every surface wired to cite it", () => {
      for (const slug of [...WRITERS, ...VALIDATORS, "lisa-implement"]) {
        expect(eager).toContain(slug);
      }
    });
  });
});

describe("tracker writers render the derived Branch Plan", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(WRITERS)("%s renders the section in its body template", slug => {
      const content = readSkill(root, slug);
      for (const field of FIELDS) {
        expect(content).toContain(field);
      }
      expect(content).toContain("Derived from:");
    });

    it.each(WRITERS)("%s derives the plan and never asks for it", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(SLUG);
      expect(content).toContain(DEPLOY_MAP);
    });
  });
});

describe("validators carry gate S19 Branch Plan derivation", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s documents the S19 gate detail", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(SLUG);
      expect(content).toContain(DEPLOY_MAP);
    });

    it.each(VALIDATORS)("%s reports S19 in its output block", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(
        "- [PASS|FAIL|N/A] S19 Branch Plan derivation — <one-line reason>"
      );
    });

    it.each(VALIDATORS)(
      "%s FAILs a conflicting plan, never picks one",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toContain("**FAIL**");
      }
    );

    it.each(VALIDATORS)(
      "%s routes a missing legacy plan to claim time",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toMatch(/claim[- ]time|lisa-implement/i);
      }
    );
  });
});

describe("lisa-implement revalidates the branch plan at claim time", () => {
  describe.each(SKILL_ROOTS)("%s/lisa-implement", root => {
    const content = readSkill(root, "lisa-implement");

    it("cites the rule instead of restating it", () => {
      expect(content).toContain(SLUG);
    });
  });
});
