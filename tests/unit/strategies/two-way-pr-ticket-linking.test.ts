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

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
] as const;
const MARKER = "[lisa-pr-link]";
const GIT_SUBMIT_PR = "lisa-git-submit-pr";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("two-way PR/ticket linking contract", () => {
  describe.each(ROOTS)("%s/lisa-git-submit-pr", root => {
    const content = readSkill(root, GIT_SUBMIT_PR);

    it("requires tracker-sync after PR creation", () => {
      expect(content).toMatch(/lisa-tracker-sync/);
      expect(content).toMatch(/pr-ready/);
      expect(content).toMatch(/pr_url=<url>|pr_url=<url>/i);
    });

    it("does not consider PR submission fully synced without a ticket backlink", () => {
      expect(content).toMatch(/ticket -> PR linkage mandatory/i);
      expect(content).toMatch(/verified native PR link/i);
      expect(content).toContain(MARKER);
    });
  });

  describe.each(ROOTS)("%s/lisa-tracker-sync", root => {
    const content = readSkill(root, "lisa-tracker-sync");

    it("documents native-first PR backlinking with managed-comment fallback", () => {
      expect(content).toMatch(/Pull request backlinking/i);
      expect(content).toMatch(/Prefer the provider's native development-link/i);
      expect(content).toMatch(/managed backlink comment/i);
      expect(content).toContain(MARKER);
    });
  });

  describe.each(ROOTS)("%s/vendor sync skills", root => {
    it.each([
      "lisa-github-sync",
      "lisa-jira-sync",
      "lisa-linear-sync",
    ] as const)("%s requires native-or-comment PR backlinking", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(/Ensure PR Backlink/i);
      expect(content).toMatch(/native/i);
      expect(content).toMatch(/cannot be verified/i);
      expect(content).toContain(MARKER);
      expect(content).toMatch(
        /Do not append duplicate|instead of appending duplicates/i
      );
    });
  });

  describe.each(ROOTS)("%s/lisa-implement", root => {
    const content = readSkill(root, "lisa-implement");

    it("requires two-way linkage before PR submission is complete", () => {
      expect(content).toMatch(/Confirm two-way linkage/i);
      expect(content).toMatch(/verified native PR link/i);
      expect(content).toContain(MARKER);
      expect(content).toMatch(/pr-merged/);
    });
  });
});

/**
 * Linear native auto-close gate (#1778).
 *
 * Unlike GitHub — whose `Closes #n` auto-close is scoped to the repository
 * default branch — Linear's GitHub integration completes a linked issue on
 * merge to ANY branch. A Linear magic word (`Closes`/`Fixes`/`Resolves ENG-x`)
 * on a merge into a non-terminal env branch therefore auto-closes the issue
 * prematurely, desyncing the env-keyed `status:*` label ladder. `git-submit-pr`
 * must gate magic words on the production/default branch, and `linear-sync` must
 * carry a post-merge reconciliation step that re-opens a natively-completed
 * Issue whose derived env is intermediate. All 5 ROOTS stay in parity.
 */
describe("Linear native auto-close env gate contract", () => {
  describe.each(ROOTS)("%s/lisa-git-submit-pr Linear magic-word gate", root => {
    const content = readSkill(root, GIT_SUBMIT_PR);

    it("states the Linear-vs-GitHub any-branch auto-close asymmetry", () => {
      expect(content).toMatch(/Linear[\s\S]*?any branch/i);
    });

    it("prohibits Linear magic words unless base is the production/default branch", () => {
      expect(content).toMatch(/Closes[\s\S]*?Fixes[\s\S]*?Resolves/);
      expect(content).toMatch(/deploy\.branches\.production/);
      expect(content).toMatch(/leaf-only-lifecycle/);
    });
  });

  describe.each(ROOTS)(
    "%s/lisa-git-submit-pr GitHub closing-keyword gate",
    root => {
      const content = readSkill(root, GIT_SUBMIT_PR);

      it("uses Closes on production/default and Refs on non-terminal env branches", () => {
        expect(content).toMatch(/Closes #<n>/);
        expect(content).toMatch(/Refs #<n>/);
      });
    }
  );

  describe.each(ROOTS)(
    "%s/lisa-linear-sync native auto-close reconciliation",
    root => {
      const content = readSkill(root, "lisa-linear-sync");

      it("carries a post-merge native auto-close reconciliation step citing leaf-only-lifecycle", () => {
        expect(content).toMatch(/reconcil/i);
        expect(content).toMatch(/any branch/i);
        expect(content).toMatch(/leaf-only-lifecycle/);
        expect(content).toMatch(/re-open[\s\S]*?native|native[\s\S]*?re-open/i);
      });

      it("is a no-op for uniform / single-environment done maps", () => {
        expect(content).toMatch(/no-op/i);
      });
    }
  );
});
