/**
 * Regression tests for runtime-specific Lisa lifecycle orchestration.
 *
 * Codex does not expose Claude's TeamCreate tool, so lifecycle skills must
 * route Codex sessions to the multi-agent tool surface directly instead of
 * telling the model to try TeamCreate first and only then fall back.
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

const BUILD_INTAKE_SKILLS = [
  ["lisa-github-build-intake", "github-agent"],
  ["lisa-jira-build-intake", "jira-agent"],
  ["lisa-linear-build-intake", "linear-agent"],
] as const;

const MULTI_AGENT_SPAWN = "multi_agent_v1.spawn_agent";

const TEAMCREATE_IF_AVAILABLE = "Use `TeamCreate` if available";

describe("Codex lifecycle skill orchestration", () => {
  it.each(
    SKILL_ROOTS.flatMap(root =>
      LIFECYCLE_SKILLS.map(skill => [root, skill] as const)
    )
  )(
    "%s/%s routes Codex to multi_agent_v1 instead of TeamCreate-first",
    (root, skill) => {
      const skillPath = path.resolve(root, skill, "SKILL.md");
      const content = readFileSync(skillPath, "utf8");

      expect(content).toContain("Codex: do not call `TeamCreate`");
      expect(content).toContain(MULTI_AGENT_SPAWN);
      expect(content).toContain("Claude Code >= 2.1.178");
      expect(content).toContain("first teammate");
      expect(
        content.includes("The initial Claude `Agent` spawn") &&
          content.includes("only pre-team exception")
      ).toBe(true);
      expect(content).not.toContain("Claude: use `TeamCreate`");
      expect(content).not.toContain(TEAMCREATE_IF_AVAILABLE);
    }
  );

  it.each(
    SKILL_ROOTS.flatMap(root =>
      DISPATCHER_SKILLS.map(skill => [root, skill] as const)
    )
  )(
    "%s/%s is a thin dispatcher that never spawns the lifecycle flow",
    (root, skill) => {
      const skillPath = path.resolve(root, skill, "SKILL.md");
      const content = readFileSync(skillPath, "utf8");

      expect(content).toContain("thin dispatcher");
      expect(content).toContain("creates NO agent team");
      expect(content).toContain("never an `Agent` spawn");
      expect(content).toContain(MULTI_AGENT_SPAWN);
      expect(content).toContain(
        "do not `spawn_agent` the lifecycle flow itself"
      );
      expect(content).not.toContain("Claude: use `TeamCreate`");
      expect(content).not.toContain(TEAMCREATE_IF_AVAILABLE);
    }
  );

  it.each(RULE_FILES)(
    "%s routes Codex to multi_agent_v1 instead of TeamCreate-first",
    rulePath => {
      const content = readFileSync(path.resolve(rulePath), "utf8");

      expect(content).toContain("Codex must not call `TeamCreate`");
      expect(content).toContain(MULTI_AGENT_SPAWN);
      expect(content).toContain(
        "Apart from the initial Claude `Agent` spawn that establishes the team"
      );
      expect(content).not.toContain(TEAMCREATE_IF_AVAILABLE);
    }
  );

  it.each(
    SKILL_ROOTS.flatMap(root =>
      BUILD_INTAKE_SKILLS.map(([skill, agent]) => [root, skill, agent] as const)
    )
  )(
    "%s/%s runs the lifecycle in-session and reserves delegation-requests for nested misrouting",
    (root, skill, agent) => {
      const skillPath = path.resolve(root, skill, "SKILL.md");
      const content = readFileSync(skillPath, "utf8");

      expect(content).toContain('"type": "delegation-request"');
      expect(content).toContain(`"phase": "${skill.replace(/^lisa-/, "")} 3c"`);
      expect(content).toContain(`exactly as \`${agent}.md\` defines them`);
      expect(content).toContain("cannot add named teammates");
      expect(content).toContain(
        "invoke the lifecycle skill via the Skill tool"
      );
      expect(content).not.toContain(`spawn or invoke \`lisa-${agent}\``);
    }
  );
});
