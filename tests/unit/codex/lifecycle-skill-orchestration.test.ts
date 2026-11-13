/**
 * Regression tests for Lisa lifecycle orchestration.
 *
 * Lifecycle skills no longer force an agent team: the session does the work in
 * one loop and delegates only sizeable, independent work. These tests pin that
 * contract so team-first mandates (TeamCreate, rosters, flat-team delegation
 * requests) do not creep back in.
 *
 * @module tests/unit/codex/lifecycle-skill-orchestration
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const RULE_FILES = [
  "plugins/src/base/rules/reference/base-rules.md",
  "plugins/lisa/rules/reference/base-rules.md",
] as const;

const BUILD_INTAKE_SKILLS = [
  ["lisa-github-build-intake", "github-agent"],
  ["lisa-jira-build-intake", "jira-agent"],
  ["lisa-linear-build-intake", "linear-agent"],
] as const;

const read = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("Lisa lifecycle skill orchestration", () => {
  it.each(RULE_FILES)(
    "%s resolves the repository root before using the project JIRA config",
    rulePath => {
      const content = readFileSync(path.resolve(rulePath), "utf8");

      expect(content).toContain("$CLAUDE_PROJECT_DIR");
      expect(content).toContain("git rev-parse --show-toplevel");
      expect(content).toContain(
        'jira --config "$PROJECT_ROOT/.lisa/jira-cli/.config.yml"'
      );
    }
  );

  it.each(
    SKILL_ROOTS.flatMap(root =>
      BUILD_INTAKE_SKILLS.map(([skill, agent]) => [root, skill, agent] as const)
    )
  )(
    "%s/%s runs the lifecycle in-session with no team delegation",
    (root, skill, agent) => {
      const content = read(root, skill);

      expect(content).toContain(`exactly as \`${agent}.md\` defines them`);
    }
  );
});
