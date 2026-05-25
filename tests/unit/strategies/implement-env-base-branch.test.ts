/**
 * Regression tests for environment-driven base-branch selection in lisa:implement.
 *
 * The build flow must work off the latest code for the ticket's target
 * environment and open its PR against that environment's branch:
 *  - Resolve the target environment from the work item's `## Target Backend
 *    Environment`; map it to a base branch via `deploy.branches`. No environment
 *    → the remote default branch.
 *  - BEFORE any work, fetch and rebase the feature branch onto `origin/<base>`,
 *    resolving merge conflicts (fix task when unresolvable).
 *  - Open the PR against that resolved base (`target_branch=<base>`).
 * This is the forward inverse of the env-keyed `done` branch inference.
 *
 * Both source and generated plugin roots are asserted.
 * @module tests/unit/strategies/implement-env-base-branch
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
/** The work-item field the target environment is read from. */
const ENV_FIELD = "Target Backend Environment";
/** The config map env→branch resolution uses (both directions). */
const DEPLOY_MAP = "deploy.branches";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("lisa:implement resolves the base branch from the ticket environment", () => {
  describe.each(ROOTS)("%s/implement", root => {
    const content = readSkill(root, "implement");

    it("resolves the target environment from the work item's Target Backend Environment", () => {
      expect(content).toMatch(/Resolve the target environment/i);
      expect(content).toContain(ENV_FIELD);
    });

    it("maps the environment to a base branch via deploy.branches", () => {
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toMatch(/base branch/i);
    });

    it("falls back to the remote default branch when no environment is named", () => {
      expect(content).toMatch(/no\*{0,2} environment|remote default branch/i);
      expect(content).toMatch(/defaultBranchRef|origin\/HEAD/);
    });

    it("rebases the feature branch onto the base and resolves conflicts BEFORE work", () => {
      expect(content).toContain(
        "Rebase the feature branch onto `origin/<base>`"
      );
      expect(content).toMatch(/resolve any merge conflicts/i);
      expect(content).toMatch(/before starting work/i);
    });

    it("creates a fix task when conflicts cannot be resolved safely", () => {
      expect(content).toMatch(/create a fix task/i);
      expect(content).toMatch(/never start work on stale or conflicted code/i);
    });

    it("opens the PR against the resolved base branch", () => {
      expect(content).toContain("target_branch=<base>");
      expect(content).toMatch(/PR targets the resolved base branch/i);
    });

    it("does not hardcode main as the PR base", () => {
      // The old linkage example hardcoded target_branch=main; it must now be
      // the env-resolved base.
      expect(content).not.toMatch(/target_branch=main\b/);
    });
  });
});

describe("config-resolution documents the forward env → base branch direction", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/rules/config-resolution.md"),
    "utf8"
  );
  it("has an Env → base branch (forward) section", () => {
    expect(content).toContain("### Env → base branch");
    expect(content).toContain(ENV_FIELD);
    expect(content).toContain(DEPLOY_MAP);
  });
  it("frames it as the inverse of the env-keyed done branch inference", () => {
    expect(content).toMatch(/forward/i);
    expect(content).toMatch(/inverse|reverse/i);
    expect(content).toMatch(/rebase/i);
  });
});
