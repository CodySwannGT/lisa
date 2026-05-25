/**
 * Regression tests for linked pull request ProjectV2 coordination.
 *
 * Issue #702 extends `git-submit-pr` so the live Pull Request created or
 * updated for a GitHub work item is also added to the configured shared
 * Project through `github-project-v2`, preserving the PR as the durable review
 * and merge surface.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/github-linked-pr-project-membership
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

describe.each(ROOTS)("git-submit-pr Project membership (%s)", root => {
  const content = readFileSync(
    path.resolve(root, "git-submit-pr", "SKILL.md"),
    "utf8"
  );

  it("delegates pull request membership through the shared utility", () => {
    expect(content).toMatch(/lisa:github-project-v2/);
    expect(content).toMatch(/operation:\s*ensure-item/i);
    expect(content).toMatch(/content_node_id/i);
    expect(content).toMatch(/Pull Request node id/i);
  });

  it("treats the pull request as the durable success surface", () => {
    expect(content).toMatch(
      /underlying PR creation\/update as the durable success|PR as the durable review\/merge surface/i
    );
    expect(content).toMatch(/continue the normal auto-merge\/watch flow/i);
  });

  it("branches linked pull request Project failures by required mode", () => {
    expect(content).toMatch(/outcome:\s*warning/i);
    expect(content).toMatch(/required:\s*false/i);
    expect(content).toMatch(/outcome:\s*blocked/i);
    expect(content).toMatch(/required:\s*true/i);
  });

  it("resolves the live pull request node id instead of inlining GraphQL", () => {
    expect(content).toMatch(/gh pr view <pr-number> --json id,url/i);
    expect(content).toMatch(
      /Never inline separate .*ProjectV2 mutations here/i
    );
  });
});
