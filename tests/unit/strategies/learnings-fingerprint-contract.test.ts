/** Six-runtime prose contract for stamped v2 project-learning writes. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LEARNER_PATHS = [
  "plugins/src/base/agents/learner.md",
  "plugins/lisa/agents/learner.md",
  "plugins/lisa-cursor/agents/learner.md",
  "plugins/lisa-agy/agents/learner.md",
  "plugins/lisa-copilot/agents/learner.agent.md",
] as const;

const PERSIST_PATHS = [
  "plugins/src/base/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-agy/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-persist-learning/SKILL.md",
] as const;

const DEBRIEF_PATHS = [
  "plugins/src/base/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-agy/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-debrief-apply/SKILL.md",
] as const;

const RULE_PATHS = [
  "plugins/src/base/rules/reference/project-learnings.md",
  "plugins/lisa/rules/reference/project-learnings.md",
  "plugins/lisa-cursor/rules/project-learnings-reference.mdc",
  "plugins/lisa-copilot/rules/reference/project-learnings.md",
] as const;

const read = (relative: string): string =>
  readFileSync(path.resolve(relative), "utf8");

describe.each(LEARNER_PATHS)("learner v2 entry contract (%s)", agentPath => {
  it("builds an eight-field entry and stamps exact consolidation targets", () => {
    const agent = read(agentPath);
    expect(agent).toMatch(/eight-field/i);
    expect(agent).toContain("`fingerprint`");
    expect(agent).toMatch(/fingerprint\s*=\s*id|id\s*=\s*fingerprint/i);
    expect(agent).toMatch(/\{\s*id[^}]*fingerprint[^}]*\}/s);
    expect(agent).toContain("onStaleSupersede");
    expect(agent).toMatch(/duplicate fingerprint/i);
  });
});

describe.each([...PERSIST_PATHS, ...DEBRIEF_PATHS])(
  "contract-mediated writer uses stamped supersede (%s)",
  skillPath => {
    it("passes observed ids with their fingerprints and handles a stale append", () => {
      const skill = read(skillPath);
      expect(skill).toContain("fingerprint");
      expect(skill).toMatch(
        /supersede:\s*\[\{[^}]*id[^}]*fingerprint[^}]*\}\]/s
      );
      expect(skill).toContain("onStaleSupersede");
      expect(skill).toMatch(/stale.*append|append.*stale/is);
    });
  }
);

describe.each(RULE_PATHS)("v1 to v2 compatibility rule (%s)", rulePath => {
  it("defines the persisted token and mutation-only migration", () => {
    const rule = read(rulePath);
    expect(rule).toMatch(/^-[ \t]+`fingerprint`[ \t]*$/m);
    expect(rule).toContain("parseLearningsDocument");
    expect(rule).toMatch(/v1/i);
    expect(rule).toMatch(/fingerprint\s*=\s*id/i);
    expect(rule).toMatch(/mutation-only|only.*mutat/is);
    expect(rule).toMatch(/v2/i);
  });
});

it("pins the built learner proof to eight-field metadata", () => {
  expect(read("scripts/verify-learner-frontmatter-built.mjs")).toContain(
    "builds eight-field entries"
  );
});
