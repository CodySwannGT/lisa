/**
 * Regression tests for two-way ticket <-> pull request linking.
 *
 * `git-submit-pr` owns PR -> work item references. The tracker sync skills own
 * the reverse work item -> PR backlink, preferring native provider linkage and
 * falling back to one managed `[lisa-pr-link]` comment when native linkage is
 * unavailable or cannot be verified.
 *
 * Both source and generated plugin roots are asserted so downstream plugin
 * distributions cannot drift from the base skill contract.
 * @module tests/unit/strategies/two-way-pr-ticket-linking
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const MARKER = "[lisa-pr-link]";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("two-way PR/ticket linking contract", () => {
  describe.each(ROOTS)("%s/git-submit-pr", root => {
    const content = readSkill(root, "git-submit-pr");

    it("requires tracker-sync after PR creation", () => {
      expect(content).toMatch(/lisa:tracker-sync/);
      expect(content).toMatch(/pr-ready/);
      expect(content).toMatch(/pr_url=<url>|pr_url=<url>/i);
    });

    it("does not consider PR submission fully synced without a ticket backlink", () => {
      expect(content).toMatch(/ticket -> PR linkage mandatory/i);
      expect(content).toMatch(/verified native PR link/i);
      expect(content).toContain(MARKER);
    });
  });

  describe.each(ROOTS)("%s/tracker-sync", root => {
    const content = readSkill(root, "tracker-sync");

    it("documents native-first PR backlinking with managed-comment fallback", () => {
      expect(content).toMatch(/Pull request backlinking/i);
      expect(content).toMatch(/Prefer the provider's native development-link/i);
      expect(content).toMatch(/managed backlink comment/i);
      expect(content).toContain(MARKER);
    });
  });

  describe.each(ROOTS)("%s/vendor sync skills", root => {
    it.each(["github-sync", "jira-sync", "linear-sync"] as const)(
      "%s requires native-or-comment PR backlinking",
      slug => {
        const content = readSkill(root, slug);

        expect(content).toMatch(/Ensure PR Backlink/i);
        expect(content).toMatch(/native/i);
        expect(content).toMatch(/cannot be verified/i);
        expect(content).toContain(MARKER);
        expect(content).toMatch(
          /Do not append duplicate|instead of appending duplicates/i
        );
      }
    );
  });

  describe.each(ROOTS)("%s/implement", root => {
    const content = readSkill(root, "implement");

    it("requires two-way linkage before PR submission is complete", () => {
      expect(content).toMatch(/Confirm two-way linkage/i);
      expect(content).toMatch(/verified native PR link/i);
      expect(content).toContain(MARKER);
      expect(content).toMatch(/pr-merged/);
    });
  });
});
