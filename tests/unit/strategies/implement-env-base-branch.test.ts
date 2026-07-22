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

const expectGrammar = (content: string): void => {
  expect(content).toContain("Confirmed: <env>");
  expect(content).toContain(
    "Inferred: <env> — evidence: <title|body|reproduction|hostname>"
  );
  expect(content).toContain(
    "Assumption: <env> — remote default branch <branch>"
  );
  expect(content).toContain("Assumption: remote default branch <branch>");
  expect(content).toMatch(/confirmation.*replaces.*bare.*`Confirmed:/is);
};

const expectSignalRules = (content: string): void => {
  expect(content).toMatch(/exact.*`deploy\.branches` key/is);
  expect(content).toMatch(/prod.*production.*exactly one/is);
  expect(content).toMatch(/No other aliases|no.*arbitrary aliases/i);
  expect(content).toMatch(/title/i);
  expect(content).toMatch(/body/i);
  expect(content).toMatch(/reproduction\s+steps/i);
  expect(content).toMatch(/URL\s+hostname|hostname/i);
  expect(content).toMatch(/URL paths|URL paths\/query/i);
  expect(content).toMatch(/substrings/i);
  expect(content).toMatch(
    /multiple conflicting|conflicting signals|conflicts stop/i
  );
  expect(content).toMatch(/stop/i);
  expect(content).toMatch(/exclud(?:e|ing).*Target Backend Environment/is);
  expect(content).toMatch(/machine-authored.*(?:metadata|draft)/is);
  expect(content).toMatch(/legacy bare\s+value/i);
  expect(content).toMatch(/managed draft markers/i);
  expect(content).toMatch(/current\s+(?:ticket\s+)?content/i);
  expect(content).toMatch(/provider\s+edit\s+history.*not\s+required/is);
  expect(content).toMatch(
    /unknown provenance.*conflict|provenance is unknown.*conflict/is
  );
};

describe("lisa-implement environment resolution", () => {
  describe.each(SKILL_ROOTS)("%s/lisa-implement", root => {
    const content = readSkill(root, "lisa-implement");

    it("defines durable provenance and deterministic precedence", () => {
      expect(content).toContain(FIELD);
      expectGrammar(content);
      expectSignalRules(content);
      expect(content).toMatch(/human-confirmed.*wins/is);
      expect(content).toMatch(/validated.*`Inferred:/is);
      expect(content).toMatch(/supersede(?:s)? only(?: an)?.*`Assumption:/is);
      expect(content).toMatch(/no signals.*remote default branch/is);
      expect(content).toMatch(/reverse-map.*not unique.*branch-only/is);
    });

    it("validates, syncs, and targets the resolved base", () => {
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toMatch(/mapped branch must exist on the remote/i);
      expect(content).toContain(
        "Rebase the feature branch onto `origin/<base>`"
      );
      expect(content).toMatch(/resolve any merge conflicts/i);
      expect(content).toContain("target_branch=<base>");
      expect(content).not.toMatch(/target_branch=main\b/);
    });

    it("records fallback and preserves the down-port contract", () => {
      expect(content).toMatch(/defaultBranchRef|origin\/HEAD/);
      expect(content).toMatch(/record (?:that |the )?fallback assumption/i);
      expect(content).toMatch(
        /forward cherry-picked down to the integration branch/i
      );
      expect(content).toMatch(/linked follow-up/i);
    });
  });
});

describe("configuration and autofill rules", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    const referenceConfig = readRule(root, "reference", "config-resolution");
    const eagerConfig = readRule(root, "eager", "config-resolution");
    const referenceAutofill = readRule(
      root,
      "reference",
      "pre-flight-autofill"
    );
    const eagerAutofill = readRule(root, "eager", "pre-flight-autofill");

    it("pins the same contract in both reference sections and eager config", () => {
      expect(referenceConfig.match(/### Env → base branch/g)).toHaveLength(2);
      expect(referenceConfig).toMatch(/forward/i);
      expect(referenceConfig).toMatch(/inverse|reverse/i);
      for (const content of [referenceConfig, eagerConfig]) {
        expectGrammar(content);
        expectSignalRules(content);
        expect(content).toContain(DEPLOY_MAP);
      }
      expect(
        referenceConfig.match(/Confirmed: <env>/g)?.length
      ).toBeGreaterThanOrEqual(2);
    });

    it("makes autofill provenance-safe", () => {
      for (const content of [referenceAutofill, eagerAutofill]) {
        expectGrammar(content);
        expectSignalRules(content);
        expect(content).toMatch(/never overwrite\s+human prose/i);
        expect(content).toMatch(/no\s+environment.*remote default/is);
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
        expectGrammar(content);
        expectSignalRules(content);
        expect(content).toMatch(/for every work item/i);
        expect(
          content.match(/Inferred: <env>/g)?.length
        ).toBeGreaterThanOrEqual(2);
        expect(
          content.match(/Assumption: <env>/g)?.length
        ).toBeGreaterThanOrEqual(2);
        expect(content).toMatch(/drives the implementation base branch/i);
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
      expectGrammar(content);
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toMatch(/every work type/i);
      expect(content.match(/Inferred: <env>/g)?.length).toBeGreaterThanOrEqual(
        2
      );
    });

    it.each(validators)(
      "%s validates configured keys and annotations",
      slug => {
        const content = readSkill(root, slug);
        expectGrammar(content);
        expect(content).toContain(DEPLOY_MAP);
        expect(content).toMatch(/exact configured key/i);
        expect(content).toMatch(/prod.*production.*exactly one/is);
        expect(content).toMatch(/legacy bare\s+value/i);
        expect(content).toMatch(/managed draft markers/i);
        expect(content).toMatch(/current\s+(?:ticket\s+)?content/i);
        expect(content).toMatch(/provider\s+edit\s+history.*not\s+required/is);
        expect(content).toMatch(
          /unknown provenance.*conflict|provenance is unknown.*conflict/is
        );
        expect(content).not.toMatch(/with one of `dev`, `staging`, `prod`/i);
      }
    );
  });
});
