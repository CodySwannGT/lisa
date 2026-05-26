/**
 * Regression tests for the GitHub PRD shipped rollup phase in github-prd-intake.
 *
 * Issue #583 (LPC-1.3): add a PRD shipped rollup phase to `github-prd-intake`.
 * After/within an intake cycle, for a ticketed GitHub PRD, read its generated
 * TOP-LEVEL child set (native `subIssues` GraphQL first; else parse the
 * machine-readable `## Tickets` generated-work section from #582) and apply the
 * GitHub terminal-state predicate to each required child:
 *   - ALL required children terminal → transition `prd-ticketed` → `prd-shipped`
 *     and leave the PRD issue open for `lisa:verify-prd`.
 *   - ANY required child incomplete/blocked → leave the PRD OPEN, do not add
 *     `prd-shipped`, and report the incomplete child set.
 *   - Idempotent: a PRD already `prd-shipped` is a no-op — no duplicate
 *     transition / shipped-time close / comment.
 * The phase cites the `prd-lifecycle-rollup` rule (#579) by slug and is
 * GitHub-only (Linear/Confluence/Notion rollup is sibling sub-task #584).
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-lifecycle-rollup (#579) and prd-backlink native-linking (#580/#581)
 * suites use.
 * @module tests/unit/strategies/github-prd-intake-rollup
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The skill's directory / slug. */
const SKILL_SLUG = "github-prd-intake";
/** The vendor-neutral rule this skill cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";
/** The build-lifecycle companion the rule (and predicate) leans on. */
const LEAF_RULE_SLUG = "leaf-only-lifecycle";

/** `describe.each` title shared by every plugin-root block. */
const ROOT_TITLE = "%s/github-prd-intake/SKILL.md";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("github-prd-intake PRD shipped rollup phase (#583)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    const content = readSkill(root);

    it("adds a dedicated PRD shipped rollup phase", () => {
      expect(content).toMatch(/PRD shipped rollup/i);
      // Implemented as a sub-phase of per-PRD processing.
      expect(content).toMatch(/3f/);
    });

    it("cites the prd-lifecycle-rollup rule by slug", () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("reads the generated top-level child set, native sub-issues first", () => {
      // Primary source: native GraphQL sub-issues.
      expect(content).toMatch(/subIssues/);
      expect(content).toMatch(/gh api graphql/);
      // Fallback source: the machine-readable generated-work section (#582).
      expect(content).toMatch(/## Tickets|## Generated Work/);
      // Top-level only — excludes leaf Sub-tasks / nested Stories.
      expect(content).toMatch(/top-level/i);
      expect(content).toMatch(/Sub-tasks?/);
      expect(content).toMatch(/exclud/i);
    });

    it("applies the GitHub terminal-state predicate (closed + status:done)", () => {
      expect(content).toMatch(/terminal/i);
      expect(content).toMatch(/CLOSED|closed/);
      expect(content).toMatch(/status:done/);
      // Closed-as-not-planned is terminal-but-dropped (excluded from shipped).
      expect(content).toMatch(/not.?planned|not_planned/i);
      expect(content).toMatch(/terminal-but-dropped|dropped/i);
    });

    it("ships and leaves the PRD open for verification when all required children are terminal", () => {
      // The single PRD-lifecycle hop performed by rollup.
      expect(content).toMatch(/TICKETED.*SHIPPED|ticketed.*shipped/i);
      expect(content).toMatch(/add-label "\$SHIPPED"|\$SHIPPED/);
      // Only on the all-terminal condition.
      expect(content).toMatch(
        /all required.*terminal|all.*generated top-level.*terminal/i
      );
      expect(content).toMatch(/left open for verify-prd|open.*verify-prd/i);
      expect(content).toMatch(/do not close at the shipped hop/i);
      expect(content).not.toMatch(/closeOnShipped|read_rollup_flag/);
    });

    it("leaves the PRD open and reports incomplete children on partial completion", () => {
      expect(content).toMatch(/incomplete/i);
      // Partial → do not ship, leave open.
      expect(content).toMatch(/leave the PRD.*open|leave.*open/i);
      expect(content).toMatch(/Do NOT add `\$SHIPPED`|do not add.*shipped/i);
      expect(content).toMatch(
        /report the incomplete child set|incomplete child set/i
      );
    });

    it("is idempotent — no-op when the PRD is already shipped", () => {
      expect(content).toMatch(/[Ii]dempoten/);
      expect(content).toMatch(/no-op/i);
      // Dedupe by child-ref identity (the rule's key).
      expect(content).toMatch(/child-ref/i);
      expect(content).toMatch(/owner\/repo#number/);
    });

    it("does not resolve shipped-time closure config", () => {
      expect(content).toMatch(
        /There is no close\/archive configuration at the shipped hop/
      );
      expect(content).not.toMatch(/github\.labels\.prd\.rollup/);
      expect(content).not.toMatch(/VERIFIED_CLOSURE/);
    });

    it("scopes the rollup to GitHub and defers Linear/Confluence/Notion to #584", () => {
      expect(content).toMatch(/GitHub-only|GitHub only/i);
      expect(content).toMatch(/#584/);
    });

    it("narrows the lifecycle/safety/rules invariants to allow shipped rollup", () => {
      // Lifecycle now includes the ticketed → shipped hop.
      expect(content).toMatch(/`\$TICKETED` → `\$SHIPPED`/);
      // The old absolute 'never touches shipped / never closes' claims are gone.
      expect(content).not.toMatch(
        /never adds, removes, or touches the `draft` or `shipped` labels/
      );
      expect(content).not.toMatch(/never closes or deletes PRD issues/);
      // Rollup is the only path that sets shipped.
      expect(content).toMatch(/rollup phase \(3f\)|rollup phase|Phase 3f/);
      expect(content).toMatch(/never closes PRD issues at the shipped hop/);
    });

    it("delegates terminal semantics to leaf-only-lifecycle for child Epics", () => {
      // A child Epic is terminal only when it has itself rolled up bottom-up.
      expect(content).toContain(LEAF_RULE_SLUG);
    });
  });
});
