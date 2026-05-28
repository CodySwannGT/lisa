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
  "debrief",
  "implement",
  "intake",
  "monitor",
  "plan",
  "research",
  "verify",
] as const;

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const RULE_FILES = [
  "plugins/src/base/rules/reference/base-rules.md",
  "plugins/lisa/rules/reference/base-rules.md",
] as const;

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
      expect(content).toContain("multi_agent_v1.spawn_agent");
      expect(content).not.toContain("Use `TeamCreate` if available");
    }
  );

  it.each(RULE_FILES)(
    "%s routes Codex to multi_agent_v1 instead of TeamCreate-first",
    rulePath => {
      const content = readFileSync(path.resolve(rulePath), "utf8");

      expect(content).toContain("Codex must not call `TeamCreate`");
      expect(content).toContain("multi_agent_v1.spawn_agent");
      expect(content).not.toContain("Use `TeamCreate` if available");
    }
  );
});
