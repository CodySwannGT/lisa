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

const LIFECYCLE_SKILLS = [
  "lisa-debrief",
  "lisa-implement",
  "lisa-monitor",
  "lisa-plan",
  "lisa-research",
  "lisa-verify",
] as const;

const DISPATCHER_SKILLS = ["lisa-intake", "lisa-repair-intake"] as const;

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const RULE_FILES = [
  "plugins/src/base/rules/reference/base-rules.md",
  "plugins/lisa/rules/reference/base-rules.md",
] as const;

/** Phrases that only exist to force or coordinate an agent team. */
const TEAM_MANDATES = [
  "TeamCreate",
  "team-first",
  "Roster Decision",
  "agent team",
  "delegation-request",
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
      expect(content).toContain("If that project config is absent");
    }
  );

  it.each(
    SKILL_ROOTS.flatMap(root =>
      LIFECYCLE_SKILLS.map(skill => [root, skill] as const)
    )
  )(
    "%s/%s works in one loop and delegates only independent work",
    (root, skill) => {
      const content = read(root, skill);

      expect(content).toContain("## How to work");
      expect(content).toContain("Delegate to a subagent only when");
      for (const mandate of TEAM_MANDATES) {
        expect(content).not.toContain(mandate);
      }
    }
  );

  it.each(
    SKILL_ROOTS.flatMap(root =>
      DISPATCHER_SKILLS.map(skill => [root, skill] as const)
    )
  )("%s/%s runs one item per cycle in its own session", (root, skill) => {
    const content = read(root, skill);

    expect(content).toContain("## How a cycle runs");
    for (const mandate of TEAM_MANDATES) {
      expect(content).not.toContain(mandate);
    }
  });

  it.each(
    SKILL_ROOTS.flatMap(root =>
      BUILD_INTAKE_SKILLS.map(([skill, agent]) => [root, skill, agent] as const)
    )
  )(
    "%s/%s runs the lifecycle in-session with no team delegation",
    (root, skill, agent) => {
      const content = read(root, skill);

      expect(content).toContain(`exactly as \`${agent}.md\` defines them`);
      expect(content).toContain(
        "invoke the lifecycle skill via the Skill tool"
      );
      expect(content).not.toContain(`spawn or invoke \`lisa-${agent}\``);
      for (const mandate of TEAM_MANDATES) {
        expect(content).not.toContain(mandate);
      }
    }
  );
});
