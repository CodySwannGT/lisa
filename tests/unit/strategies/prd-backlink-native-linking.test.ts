/**
 * Regression tests for native GitHub sub-issue linking in the prd-backlink skill.
 *
 * Issue #580 (LPC-1.1): extend `prd-backlink` so that when the PRD source is a
 * GitHub Issue and the created tickets live in the same repo, each generated
 * top-level work item (Epic / top-level Story) is linked as a NATIVE GitHub
 * sub-issue of the PRD issue via the `addSubIssue` GraphQL mutation — making the
 * PRD the structural parent of its generated work rather than only a documented
 * `## Tickets` backlink. Part of PRD #525; cites the `prd-lifecycle-rollup` rule
 * (#579) by slug.
 *
 * The behavior must be:
 *   (a) GitHub same-repo only — a same-repo guard parses owner/repo from the PRD
 *       ref and each ticket and skips cross-repo / cross-vendor tickets;
 *   (b) generated-top-level-work only — Epics / top-level Stories (parent_key
 *       null) become PRD children; leaf Sub-tasks / descendants never do;
 *   (c) idempotent — dedupe by child-ref (`owner/repo#number`): read the PRD's
 *       existing sub-issues first and no-op anything already linked;
 *   (d) graceful degradation — already-linked and mutation-unavailable (older
 *       GHES / sub-issues off) fall back to the documented section only and warn,
 *       never silently drop the relationship and never abort;
 *   (e) the documented `## Tickets` section is still always written;
 *   (f) the `prd-lifecycle-rollup` rule is cited by slug.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-lifecycle-rollup (#579) suite uses.
 * @module tests/unit/strategies/prd-backlink-native-linking
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The skill's directory / slug. */
const SKILL_SLUG = "prd-backlink";
/** The vendor-neutral rule this skill cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("prd-backlink native GitHub sub-issue linking (#580)", () => {
  describe.each(SKILL_ROOTS)("%s/prd-backlink/SKILL.md", root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    const content = readSkill(root);

    it("documents a GitHub native sub-issue linking section", () => {
      expect(content).toMatch(/Native parent linking \(GitHub\)/);
      expect(content).toMatch(/sub-issue/i);
    });

    // (f) cites the prd-lifecycle-rollup rule by slug, doesn't restate taxonomy.
    it("cites the prd-lifecycle-rollup rule by slug", () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the addSubIssue mutation reused from github-write-issue Phase 6.
    it("uses the addSubIssue GraphQL mutation", () => {
      expect(content).toContain("addSubIssue");
      expect(content).toMatch(/issueId:\$parentId,subIssueId:\$childId/);
      // References the canonical write-path source of the mutation.
      expect(content).toContain("github-write-issue");
    });

    // Reads the PRD's existing sub-issues to dedupe (github-read-issue Phase 3).
    it("reads the PRD's existing sub-issues before linking", () => {
      expect(content).toContain("subIssues");
      expect(content).toContain("github-read-issue");
    });

    // (a) same-repo guard.
    it("only links when the PRD and ticket are in the same repository", () => {
      expect(content).toMatch(/[Ss]ame-repo guard/);
      expect(content).toMatch(/owner\/repo/);
      // Cross-repo / cross-vendor tickets are skipped (documented-only).
      expect(content).toMatch(/cross-repo|cross-vendor/i);
    });

    // (b) generated-top-level-work only — leaf Sub-tasks are NOT PRD children.
    it("links only generated top-level work, never leaf Sub-tasks", () => {
      expect(content).toMatch(/generated top-level work/i);
      // Top-level decided structurally by null parent_key.
      expect(content).toMatch(/parent_key/);
      // Leaf Sub-tasks explicitly excluded from direct PRD children.
      expect(content).toMatch(
        /Sub-tasks?.*NOT.*direct PRD children|NOT direct PRD children|never.*linked directly to the PRD/i
      );
    });

    // (c) idempotency — dedupe by child-ref identity.
    it("is idempotent, deduping by child-ref (owner/repo#number)", () => {
      expect(content).toMatch(/[Ii]dempoten/);
      expect(content).toMatch(/child-ref/);
      expect(content).toMatch(/owner\/repo#number/);
      expect(content).toMatch(/no-op/i);
    });

    // (d) graceful degradation — already linked + mutation unavailable.
    it("degrades gracefully when already linked or mutation unavailable", () => {
      expect(content).toMatch(/[Gg]raceful degradation/);
      expect(content).toMatch(/already linked/i);
      // Older GHES / sub-issues feature off.
      expect(content).toMatch(/GHES|sub-issues feature off|unavailable/i);
      // Falls back to documented section + warns; never silently fails / aborts.
      expect(content).toMatch(/warn/i);
      expect(content).toMatch(/never.*silently|never abort/i);
    });

    // (e) documented section is still always written.
    it("still always writes the documented ## Tickets section", () => {
      expect(content).toMatch(/## Tickets/);
      expect(content).toMatch(
        /documented.*(always|either way|in addition)|always written/i
      );
    });
  });
});
