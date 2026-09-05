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

/** The rendered section heading, identical across vendors. */
const SECTION = "Branch Plan";

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
      expect(eager).toContain(SECTION);
      for (const field of FIELDS) {
        expect(eager).toContain(field);
        expect(reference).toContain(field);
      }
    });

    it("subordinates the plan to the environment authority", () => {
      expect(eager).toContain(AUTHORITY);
      expect(eager).toContain(DEPLOY_MAP);
      // The whole point: derived data, not a peer authority.
      expect(eager).toMatch(/derived data, not a second (?:source|authority)/i);
      expect(eager).toMatch(/never (?:an )?input|never read as input/i);
      expect(reference).toMatch(/environment wins|authority.*wins/i);
    });

    it("forbids the independent-default failure mode by name", () => {
      // The tempting shortcut that silently ships to the wrong environment.
      expect(eager).toMatch(
        /never default(?:s)? (?:independently )?to `?main/i
      );
      expect(reference).toMatch(/second source of truth/i);
    });

    it("states the two fields are the same branch by construction", () => {
      expect(eager).toMatch(/same branch by construction/i);
      // ...and that a legitimate divergence is a separate follow-up item,
      // so nobody "fixes" the invariant by loosening it.
      expect(reference).toMatch(/cherry-pick|follow-up (?:work )?item/i);
    });

    it("carries the derivation provenance line that marks it machine-authored", () => {
      expect(eager).toContain("Derived from:");
      expect(reference).toMatch(
        /without .*provenance line.*hand-authored|treated as hand-authored/i
      );
    });

    it("defines the exemption for work with no runtime environment", () => {
      expect(eager).toMatch(/runtime_behavior_change\s*=\s*false/);
      expect(eager).toMatch(/doc-only|documentation/i);
      expect(eager).toMatch(/config-only/i);
      expect(eager).toMatch(/type-only/i);
      // Absence there is correct, not a missing section.
      expect(eager).toMatch(/absence is correct|no branch plan is required/i);
      expect(reference).toMatch(/Epic|container/);
    });

    it("stops rather than guesses when derivation cannot complete", () => {
      expect(eager).toMatch(/ambiguous|not unique/i);
      expect(eager).toMatch(/must exist on the remote/i);
      expect(eager).toMatch(/stops?\b/i);
      expect(reference).toMatch(/never guess|no silent guess/i);
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
      // JIRA wiki markup uses `h2.`, GitHub/Linear use `##` — assert the
      // heading text, which is identical, plus both field labels.
      expect(content).toContain(SECTION);
      for (const field of FIELDS) {
        expect(content).toContain(field);
      }
      expect(content).toContain("Derived from:");
    });

    it.each(WRITERS)("%s derives the plan and never asks for it", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(SLUG);
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toMatch(/derived|recomputed/i);
      // A writer that accepts caller-supplied branches is the drift vector.
      expect(content).toMatch(
        /never (?:accept|take).*caller|generated.*never hand-authored|do not accept.*branch/i
      );
    });

    it.each(WRITERS)("%s omits the section for exempt work", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(/runtime_behavior_change\s*=\s*false|doc-only/i);
    });
  });
});

describe("validators carry gate S19 Branch Plan derivation", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s registers S19 in its gate table", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(
        "| S19 Branch Plan derivation | `technical` | false |"
      );
    });

    it.each(VALIDATORS)("%s documents the S19 gate detail", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain("#### S19 — Branch Plan derivation");
      expect(content).toContain(SLUG);
      expect(content).toContain(DEPLOY_MAP);
    });

    it.each(VALIDATORS)("%s reports S19 in its output block", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(
        "- [PASS|FAIL|N/A] S19 Branch Plan derivation — <one-line reason>"
      );
    });

    it.each(VALIDATORS)("%s recomputes rather than trusting the plan", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(/recomputes?\b.*current config|from current/i);
      expect(content).toMatch(/never .*(?:trust|read).*as input|derived only/i);
    });

    it.each(VALIDATORS)(
      "%s FAILs a conflicting plan, never picks one",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toMatch(/Plan conflicts with the recomputed plan/i);
        expect(content).toContain("**FAIL**");
        expect(content).toMatch(
          /never silently (?:choose|choos|pick|reconcil)/i
        );
        // The remediation must point at the environment, not at the branches.
        expect(content).toMatch(
          /(?:fix|correct|change).*environment.*(?:not|never).*branch/is
        );
      }
    );

    it.each(VALIDATORS)("%s FAILs a malformed two-branch plan", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(/two different branches|differ.*malformed/i);
    });

    it.each(VALIDATORS)("%s is N/A for exempt work", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(
        /`N\/A`.*doc-only|Skipped for doc-only|N\/A for doc-only/i
      );
    });

    it.each(VALIDATORS)("%s FAILs a plan on exempt work", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(
        /Branch Plan.*(?:present|on).*exempt|exempt.*carries a Branch Plan/is
      );
    });

    it.each(VALIDATORS)(
      "%s routes a missing legacy plan to claim time",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toMatch(/legacy/i);
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
      expect(content).toContain(SECTION);
    });

    it("recomputes against current config and the remote", () => {
      expect(content).toMatch(/recompute/i);
      expect(content).toMatch(/current config/i);
      expect(content).toMatch(/remote/i);
    });

    it("writes the derived assumption onto a legacy item with no plan", () => {
      expect(content).toMatch(/legacy/i);
      expect(content).toMatch(/comment/i);
      expect(content).toContain("[lisa-branch-plan]");
      // Written, then proceed — the whole point of the legacy arm.
      expect(content).toMatch(/then proceed|and proceed/i);
    });

    it("never proceeds on an unwritten guess", () => {
      expect(content).toMatch(/no silent guess|never silently guess/i);
    });

    it("stops on a conflict with a confirmed environment or a PR base", () => {
      expect(content).toMatch(/human-confirmed/i);
      expect(content).toMatch(/PR'?s? base|existing PR base/i);
      expect(content).toMatch(/confirmation/i);
    });

    it("lets current config win over a stale rendered plan", () => {
      expect(content).toMatch(/stale/i);
      expect(content).toMatch(
        /config wins|re-?render|never follow(?:s)? the stale/i
      );
    });
  });
});
