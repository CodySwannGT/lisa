/** Regression coverage for deterministic environment-to-base resolution. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const AGENT_ROOTS = [
  "plugins/src/base/agents",
  "plugins/lisa/agents",
  "plugins/lisa-cursor/agents",
  "plugins/lisa-agy/agents",
  "plugins/lisa-copilot/agents",
] as const;
const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;
const DEPLOY_MAP = "deploy.branches";
const FIELD = "Target Backend Environment";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");
const readAgent = (root: string, slug: string): string =>
  readFileSync(
    path.resolve(
      root,
      `${slug}${root.includes("lisa-copilot") ? ".agent.md" : ".md"}`
    ),
    "utf8"
  );
const readRule = (
  root: string,
  group: "eager" | "reference",
  slug: string
): string => {
  if (root.includes("lisa-cursor")) {
    return readFileSync(
      path.resolve(
        root,
        `${slug}${group === "reference" ? "-reference" : ""}.mdc`
      ),
      "utf8"
    );
  }
  return readFileSync(path.resolve(root, group, `${slug}.md`), "utf8");
};

const expectSignalRules = (content: string): void => {
  expect(content).toMatch(/exact.*`deploy\.branches` key/is);
};

describe("lisa-implement environment resolution", () => {
  describe.each(SKILL_ROOTS)("%s/lisa-implement", root => {
    const content = readSkill(root, "lisa-implement");

    it("defines durable provenance and deterministic precedence", () => {
      expect(content).toContain(FIELD);
      expectSignalRules(content);
    });

    it("validates, syncs, and targets the resolved base", () => {
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toContain(
        "Sync the feature branch onto the latest `origin/<base>`"
      );
      expect(content).toContain("target_branch=<base>");
      expect(content).not.toMatch(/target_branch=main\b/);
    });

    it("records fallback and preserves the down-port contract", () => {
      expect(content).toMatch(/defaultBranchRef|origin\/HEAD/);
    });
  });
});

describe("configuration and autofill rules", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    const referenceConfig = readRule(root, "reference", "config-resolution");
    const referenceAutofill = readRule(
      root,
      "reference",
      "pre-flight-autofill"
    );
    const eagerAutofill = readRule(root, "reference", "pre-flight-autofill");

    it("pins the same contract in both reference sections and eager config", () => {
      expect(referenceConfig.match(/### Env → base branch/g)).toHaveLength(2);
      // #3992 moved the env grammar out of the always-on config-resolution head
      // into its reference body: it is tracker-write mechanics. One copy now.
      for (const content of [referenceConfig]) {
        expectSignalRules(content);
        expect(content).toContain(DEPLOY_MAP);
      }
      expect(
        referenceConfig.match(/Confirmed: <env>/g)?.length
      ).toBeGreaterThanOrEqual(2);
    });

    it("makes autofill provenance-safe", () => {
      for (const content of [referenceAutofill, eagerAutofill]) {
        expectSignalRules(content);
        expect(content).toContain(DEPLOY_MAP);
      }
    });
  });
});

describe("tracker handoffs", () => {
  describe.each(AGENT_ROOTS)("%s", root => {
    it.each(["github-agent", "jira-agent", "linear-agent"])(
      "%s repeats the contract in early and final summaries",
      agent => {
        const content = readAgent(root, agent);
        expectSignalRules(content);
        expect(
          content.match(/Inferred: <env>/g)?.length
        ).toBeGreaterThanOrEqual(2);
        expect(
          content.match(/Assumption: <env>/g)?.length
        ).toBeGreaterThanOrEqual(2);
      }
    );
  });
});

describe("tracker writers and S8 validators", () => {
  const writers = [
    "lisa-github-write-issue",
    "lisa-jira-write-ticket",
    "lisa-linear-write-issue",
  ] as const;
  const validators = [
    "lisa-github-validate-issue",
    "lisa-jira-validate-ticket",
    "lisa-linear-validate-issue",
  ] as const;

  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(writers)("%s carries grammar in its table and template", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(DEPLOY_MAP);
      expect(content.match(/Inferred: <env>/g)?.length).toBeGreaterThanOrEqual(
        2
      );
    });

    it.each(validators)(
      "%s validates configured keys and annotations",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toContain(DEPLOY_MAP);
      }
    );
  });
});
