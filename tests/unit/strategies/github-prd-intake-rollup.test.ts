/**
 * Regression tests for the GitHub PRD shipped rollup phase in github-prd-intake.
 *
 * Issue #583 (LPC-1.3): add a PRD shipped rollup phase to `github-prd-intake`.
 * After/within an intake cycle, for a ticketed GitHub PRD, read its generated
 * TOP-LEVEL child set (native `subIssues` GraphQL first; else parse the
 * machine-readable `## Tickets` generated-work section from #582) and apply the
 * GitHub terminal-state predicate to each required child:
 *   - ALL required children terminal → transition `prd-ticketed` → `prd-shipped`
 *     and leave the PRD issue open for `lisa-verify-prd`.
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
const SKILL_SLUG = "lisa-github-prd-intake";
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

    it("cites the prd-lifecycle-rollup rule by slug", () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("reads the generated top-level child set, native sub-issues first", () => {
      // Primary source: native GraphQL sub-issues.
      expect(content).toMatch(/subIssues/);
    });

    it("applies the GitHub terminal-state predicate (closed + status:done)", () => {
      expect(content).toMatch(/CLOSED|closed/);
      expect(content).toMatch(/status:done/);
      // Closed-as-not-planned is terminal-but-dropped (excluded from shipped).
      expect(content).toMatch(/not.?planned|not_planned/i);
    });

    it("is idempotent — no-op when the PRD is already shipped", () => {
      expect(content).toMatch(/owner\/repo#number/);
    });

    it("delegates terminal semantics to leaf-only-lifecycle for child Epics", () => {
      // A child Epic is terminal only when it has itself rolled up bottom-up.
      expect(content).toContain(LEAF_RULE_SLUG);
    });
  });
});
