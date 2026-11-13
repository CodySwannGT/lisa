/**
 * Regression tests for the workflow-change verification skill.
 *
 * Issue #1615 adds a Lisa skill for pre-merge GitHub Actions workflow proof.
 * The important contract is not executable business logic; it is the procedure
 * agents must follow so they do not mistake default-branch workflow runs for
 * branch-copy evidence and so verification leaves no repository debris.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/verify-workflow-change-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const GENERATED_SKILL_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const COMMAND_REL = "commands/verify-workflow-change.md";
const SKILL_REL = "skills/lisa-verify-workflow-change/SKILL.md";
const DEFAULT_BRANCH_TRIGGERS = [
  "workflow_run",
  "schedule",
  "issue_comment",
  "pull_request_review",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify workflow change skill (#1615)", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, SKILL_REL);
    const command = read(root, COMMAND_REL);

    it("ships the pass-through command and skill", () => {
      expect(existsSync(path.resolve(root, COMMAND_REL))).toBe(true);
      expect(existsSync(path.resolve(root, SKILL_REL))).toBe(true);
      expect(command).toContain("Use the /lisa-verify-workflow-change skill");
      expect(command).toContain("$ARGUMENTS");
    });

    it("declares workflow verification frontmatter", () => {
      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-verify-workflow-change/);
      expect(skill).toMatch(
        /description:.*GitHub Actions workflow file changed/
      );
      expect(skill).toContain('allowed-tools: ["Bash", "Read"]');
    });

    it("names the default-branch execution trap", () => {
      for (const trigger of DEFAULT_BRANCH_TRIGGERS) {
        expect(skill).toContain(trigger);
      }
    });

    it("requires branch-ref dispatch through a workflow_dispatch sibling", () => {
      expect(skill).toContain("workflow_dispatch");
      expect(skill).toContain("--ref <branch>");
    });

    it("restores gate variables exactly, including unset state", () => {
      expect(skill).toContain("gh variable delete <NAME>");
      expect(skill).toContain("gh variable set <NAME>");
    });
  });

  it.each(GENERATED_SKILL_ROOTS)(
    "ships the generated skill for %s",
    skillRoot => {
      expect(
        existsSync(
          path.resolve(skillRoot, "lisa-verify-workflow-change", "SKILL.md")
        )
      ).toBe(true);
    }
  );
});
