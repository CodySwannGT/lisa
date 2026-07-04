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
/** `it` title shared by every vendor block — top-level-only guarantee. */
const TOP_LEVEL_ONLY_TITLE =
  "links only generated top-level work, never leaf Sub-tasks";

/** Section headings used to slice a single vendor's section out of the skill. */
const LINEAR_HEADING = "## Native parent linking (Linear)";
const JIRA_HEADING = "## Native parent linking (JIRA)";
const FAILURES_HEADING = "## Failures";

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

    it("documents a GitHub native sub-issue linking section", () => {
      expect(content).toMatch(/Native parent linking \(GitHub\)/);
      expect(content).toMatch(/sub-issue/i);
    });

    // (f) cites the prd-lifecycle-rollup rule by slug, doesn't restate taxonomy.
    it(CITES_RULE_TITLE, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the addSubIssue mutation reused from github-write-issue Phase 6.
    it("uses the addSubIssue GraphQL mutation", () => {
      expect(content).toContain("addSubIssue");
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
      expect(content).toMatch(/[Ss]ame-repo guard/);
      expect(content).toMatch(/owner\/repo/);
      // Cross-repo / cross-vendor tickets are skipped (documented-only).
      expect(content).toMatch(/cross-repo|cross-vendor/i);
    });

    // (b) generated-top-level-work only — leaf Sub-tasks are NOT PRD children.
    it(TOP_LEVEL_ONLY_TITLE, () => {
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

describe("prd-backlink native Linear parent/project linking (#581)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const content = readSkill(root);
    const linearSection = sliceSection(content, LINEAR_HEADING, JIRA_HEADING);

    it("documents a Linear native parent linking section", () => {
      expect(content).toMatch(/Native parent linking \(Linear\)/);
      // Linear's native primitives: parent / project relationship.
      expect(content).toMatch(/parentId/);
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
      // Project members and/or sub-Issue reads.
      expect(content).toMatch(/list-issues|get-issue/);
    });

    // (b) generated-top-level-work only — leaf Sub-tasks are NOT PRD children.
    it(TOP_LEVEL_ONLY_TITLE, () => {
      expect(linearSection).toMatch(/generated top-level work/i);
      expect(linearSection).toMatch(/parent_key/);
      expect(linearSection).toMatch(
        /Sub-tasks?.*NOT.*direct PRD children|never.*linked directly to the PRD/i
      );
    });

    // (c) idempotency — dedupe by child-ref identity (Linear id / UUID).
    it("is idempotent, deduping by Linear child-ref (identifier/UUID)", () => {
      expect(linearSection).toMatch(/[Ii]dempoten/);
      expect(linearSection).toMatch(/child-ref/);
      expect(linearSection).toMatch(/identifier|UUID/);
      expect(linearSection).toMatch(/no-op/i);
    });

    // (d) graceful degradation — already attached / no native hierarchy.
    it("degrades gracefully when already attached or cross-vendor", () => {
      expect(linearSection).toMatch(/[Gg]raceful degradation/);
      expect(linearSection).toMatch(/already attached/i);
      expect(linearSection).toMatch(/cross-vendor|no native hierarchy|no-op/i);
      expect(linearSection).toMatch(/warn/i);
      expect(linearSection).toMatch(/never.*silently|never abort/i);
    });
  });
});

describe("prd-backlink native JIRA parent/issue-link linking (#581)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const content = readSkill(root);
    const jiraSection = sliceSection(content, JIRA_HEADING, FAILURES_HEADING);

    it("documents a JIRA native parent linking section", () => {
      expect(content).toMatch(/Native parent linking \(JIRA\)/);
      // Native parent / Epic link, or a documented issue-link type fallback.
      expect(content).toMatch(/Epic link/);
      expect(content).toMatch(/issue-link type/i);
    });

    // Cites the prd-lifecycle-rollup rule by slug (shared contract).
    it(CITES_RULE_TITLE, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // Uses the same Atlassian write/link primitives as jira-write-ticket.
    it("uses atlassian-access write/link and jira-write-ticket", () => {
      expect(content).toContain("lisa-atlassian-access");
      expect(content).toMatch(/operation: write-ticket|operation: link/);
      expect(content).toContain("lisa-jira-write-ticket");
    });

    // Reads the PRD's existing children/links before linking (jira-read-ticket).
    it("reads the PRD's existing children/links before linking", () => {
      expect(content).toContain("lisa-jira-read-ticket");
      // Epic-link / parent JQL or issuelinks read.
      expect(content).toMatch(/Epic Link|issuelinks|parent =/);
    });

    // (b) generated-top-level-work only — leaf Sub-tasks are NOT PRD children.
    it(TOP_LEVEL_ONLY_TITLE, () => {
      expect(jiraSection).toMatch(/generated top-level work/i);
      expect(jiraSection).toMatch(/parent_key/);
      expect(jiraSection).toMatch(
        /Sub-tasks?.*NOT.*direct PRD children|never.*linked directly to the PRD/i
      );
    });

    // (c) idempotency — dedupe by child-ref identity (JIRA issue key).
    it("is idempotent, deduping by JIRA child-ref (issue key)", () => {
      expect(jiraSection).toMatch(/[Ii]dempoten/);
      expect(jiraSection).toMatch(/child-ref/);
      expect(jiraSection).toMatch(/issue key/i);
      expect(jiraSection).toMatch(/no-op/i);
    });

    // (d) graceful degradation — already attached / no native hierarchy.
    it("degrades gracefully when already attached or cross-vendor", () => {
      expect(jiraSection).toMatch(/[Gg]raceful degradation/);
      expect(jiraSection).toMatch(/already attached/i);
      expect(jiraSection).toMatch(/cross-vendor|no native hierarchy|no-op/i);
      expect(jiraSection).toMatch(/warn/i);
      expect(jiraSection).toMatch(/never.*silently|never abort/i);
    });
  });
});
