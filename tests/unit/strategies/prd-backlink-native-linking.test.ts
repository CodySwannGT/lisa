/**
 * Regression tests for native PRD→top-level-work linking in the prd-backlink skill.
 *
 * Issue #580 (LPC-1.1): extend `prd-backlink` so that when the PRD source is a
 * GitHub Issue and the created tickets live in the same repo, each generated
 * top-level work item (Epic / top-level Story) is linked as a NATIVE GitHub
 * sub-issue of the PRD issue via the `addSubIssue` GraphQL mutation — making the
 * PRD the structural parent of its generated work rather than only a documented
 * `## Tickets` backlink. Part of PRD #525; cites the `prd-lifecycle-rollup` rule
 * (#579) by slug.
 *
 * Issue #581 (LPC-1.1, Linear/JIRA leg): extend the same skill so that when the
 * PRD source is Linear or JIRA and the PRD lives in the same system, generated
 * top-level work is attached via that vendor's NATIVE parent relationship —
 * Linear `projectId`/`parentId` (via `linear-access` save-issue), JIRA native parent / Epic
 * link or a documented issue-link type (via `atlassian-access`). Same contract as
 * the GitHub leg: top-level-only, idempotent (dedupe by child-ref — Linear
 * identifier/UUID, JIRA issue key), graceful degradation (cross-vendor / no
 * native hierarchy is a clean no-op that falls back to the documented section and
 * warns, never aborts). Cites the `prd-lifecycle-rollup` rule (#579) by slug.
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
const SKILL_SLUG = "lisa-prd-backlink";
/** The vendor-neutral rule this skill cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

/** `describe.each` title shared by every plugin-root block. */
const ROOT_TITLE = "%s/prd-backlink/SKILL.md";
/** `it` title shared by every vendor block — cites the rule by slug. */
const CITES_RULE_TITLE = "cites the prd-lifecycle-rollup rule by slug";

/** Section headings used to slice a single vendor's section out of the skill. */
const LINEAR_HEADING = "## Native parent linking (Linear)";
const JIRA_HEADING = "## Native parent linking (JIRA)";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

/**
 * Slice the substring of a skill body between two headings.
 * @param content - The full SKILL.md body.
 * @param start - The heading where the slice begins (inclusive).
 * @param end - The heading where the slice ends (exclusive).
 * @returns The substring from `start` up to (but not including) `end`.
 */
const sliceSection = (content: string, start: string, end: string): string =>
  content.slice(content.indexOf(start), content.indexOf(end));

describe("prd-backlink native GitHub sub-issue linking (#580)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    const content = readSkill(root);

    // (f) cites the prd-lifecycle-rollup rule by slug, doesn't restate taxonomy.
    it(CITES_RULE_TITLE, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the addSubIssue mutation reused from github-write-issue Phase 6.
    it("uses the addSubIssue GraphQL mutation", () => {
      expect(content).toMatch(/issueId:\$parentId,subIssueId:\$childId/);
      // References the canonical write-path source of the mutation.
      expect(content).toContain("lisa-github-write-issue");
    });

    // Reads the PRD's existing sub-issues to dedupe (github-read-issue Phase 3).
    it("reads the PRD's existing sub-issues before linking", () => {
      expect(content).toContain("subIssues");
      expect(content).toContain("lisa-github-read-issue");
    });

    // (a) same-repo guard.
    it("only links when the PRD and ticket are in the same repository", () => {
      expect(content).toMatch(/owner\/repo/);
    });

    // (c) idempotency — dedupe by child-ref identity.
    it("is idempotent, deduping by child-ref (owner/repo#number)", () => {
      expect(content).toMatch(/owner\/repo#number/);
    });
  });
});

describe("prd-backlink native Linear parent/project linking (#581)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const content = readSkill(root);
    const linearSection = sliceSection(content, LINEAR_HEADING, JIRA_HEADING);

    it("documents a Linear native parent linking section", () => {
      expect(content).toMatch(/projectId/);
    });

    // Cites the prd-lifecycle-rollup rule by slug (shared contract).
    it(CITES_RULE_TITLE, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the same Linear access-layer write operation as linear-write-issue.
    it("uses the Linear save-issue operation and linear-write-issue", () => {
      expect(content).toContain("lisa-linear-access operation: save-issue");
      expect(content).toContain("lisa-linear-write-issue");
    });

    // Reads the PRD's existing children before linking (linear-read-issue).
    it("reads the PRD's existing children before linking", () => {
      expect(content).toContain("lisa-linear-read-issue");
    });

    // (c) idempotency — dedupe by child-ref identity (Linear id / UUID).
    it("is idempotent, deduping by Linear child-ref (identifier/UUID)", () => {
      expect(linearSection).toMatch(/identifier|UUID/);
    });
  });
});

describe("prd-backlink native JIRA parent/issue-link linking (#581)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const content = readSkill(root);

    it("documents a JIRA native parent linking section", () => {
      expect(content).toMatch(/Native parent linking \(JIRA\)/);
    });

    // Cites the prd-lifecycle-rollup rule by slug (shared contract).
    it(CITES_RULE_TITLE, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the same Atlassian write/link primitives as jira-write-ticket.
    it("uses atlassian-access write/link and jira-write-ticket", () => {
      expect(content).toContain("lisa-atlassian-access");
      expect(content).toContain("lisa-jira-write-ticket");
    });

    // Reads the PRD's existing children/links before linking (jira-read-ticket).
    it("reads the PRD's existing children/links before linking", () => {
      expect(content).toContain("lisa-jira-read-ticket");
    });
  });
});
