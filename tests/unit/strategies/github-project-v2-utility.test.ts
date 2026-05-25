/**
 * Regression tests for the shared GitHub ProjectV2 utility contract.
 *
 * Issue #700 introduces a single chokepoint skill for Project membership so
 * `github-write-prd`, `github-write-issue`, and linked-PR/evidence flows do
 * not duplicate GraphQL handling. The utility must resolve the configured
 * Project, add Issue or Pull Request node ids, optionally update Project
 * fields, and preserve exact GitHub failures while branching by `required`.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/github-project-v2-utility
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe.each(ROOTS)("github-project-v2 utility (%s)", root => {
  const content = readSkill(root, "github-project-v2");

  it("defines a shared ProjectV2 chokepoint for GitHub writers", () => {
    expect(content).toMatch(/single chokepoint/i);
    expect(content).toMatch(/github-write-prd/i);
    expect(content).toMatch(/github-write-issue/i);
    expect(content).toMatch(/linked-PR/i);
  });

  it("documents project resolution from github.projects.v2 config", () => {
    expect(content).toMatch(/github\.projects\.v2/i);
    expect(content).toMatch(/owner\.kind/i);
    expect(content).toMatch(/owner\.slug/i);
    expect(content).toMatch(/number/i);
    expect(content).toMatch(/projectV2/i);
  });

  it("supports issue or pull request membership plus optional field updates", () => {
    expect(content).toMatch(/Issue or Pull Request node id/i);
    expect(content).toMatch(/addProjectV2ItemById/);
    expect(content).toMatch(/update-fields/i);
    expect(content).toMatch(
      /single-select|text field|iteration field|date field/i
    );
  });

  it("preserves exact GitHub failures and branches by required mode", () => {
    expect(content).toMatch(
      /exact GitHub failure text|exact gh \/ GraphQL failure/i
    );
    expect(content).toMatch(/required:\s*false/i);
    expect(content).toMatch(/outcome:\s*warning/i);
    expect(content).toMatch(/required:\s*true/i);
    expect(content).toMatch(/outcome:\s*blocked/i);
  });

  it("treats duplicate membership idempotently for ensure-item", () => {
    expect(content).toMatch(/ensure-item/i);
    expect(content).toMatch(
      /already in the Project|already-present|duplicate-membership/i
    );
    expect(content).toMatch(/outcome:\s*reused/i);
  });

  it("enforces the v1 namespace match rule", () => {
    expect(content).toMatch(/owner\.slug.*MUST equal.*github\.org/i);
    expect(content).toMatch(/project_namespace_mismatch/i);
  });
});
