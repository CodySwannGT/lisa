/**
 * Regression tests for environment-driven base-branch selection in lisa-implement.
 *
 * The build flow must work off the latest code for the ticket's target
 * environment and open its PR against that environment's branch:
 *  - Resolve the target environment from the work item's `## Target Backend
 *    Environment`; for bugs, the reported environment in the body/repro wins
 *    over a generic autofill default; map it to a base branch via
 *    `deploy.branches`. No environment → the remote default branch.
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
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
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
/** The work-item field the target environment is read from. */
const ENV_FIELD = "Target Backend Environment";
/** The config map env→branch resolution uses (both directions). */
const DEPLOY_MAP = "deploy.branches";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");
const readAgent = (root: string, slug: string): string => {
  const suffix = root.includes("lisa-copilot") ? ".agent.md" : ".md";
  return readFileSync(path.resolve(root, `${slug}${suffix}`), "utf8");
};
const readRule = (
  root: string,
  group: "eager" | "reference",
  slug: string
): string => {
  if (root.includes("lisa-cursor")) {
    const suffix = group === "reference" ? "-reference" : "";
    return readFileSync(path.resolve(root, `${slug}${suffix}.mdc`), "utf8");
  }

  return readFileSync(path.resolve(root, group, `${slug}.md`), "utf8");
};

describe("lisa-implement resolves the base branch from the ticket environment", () => {
  describe.each(SKILL_ROOTS)("%s/lisa-implement", root => {
    const content = readSkill(root, "lisa-implement");

    it("resolves the target environment from the work item's Target Backend Environment", () => {
      expect(content).toMatch(/Resolve the target environment/i);
      expect(content).toContain(ENV_FIELD);
    });

    it("maps the environment to a base branch via deploy.branches", () => {
      expect(content).toContain(DEPLOY_MAP);
      expect(content).toMatch(/base branch/i);
    });

    it("treats a bug's reported environment as authoritative over autofill defaults", () => {
      expect(content).toMatch(/For bug work/i);
      expect(content).toMatch(/reported environment wins/i);
      expect(content).toMatch(/staging\.<domain>|gql\.staging/i);
    });

    it("falls back to the remote default branch when no environment is named", () => {
      expect(content).toMatch(/no\*{0,2} environment|remote default branch/i);
      expect(content).toMatch(/defaultBranchRef|origin\/HEAD/);
    });

    it("records the fallback assumption when no environment is named", () => {
      expect(content).toMatch(
        /record that fallback assumption in the plan\/tracker artifact/i
      );
    });

    it("stops rather than defaulting when the reported environment is unmapped", () => {
      expect(content).toMatch(
        /reported environment is absent from `deploy\.branches`/i
      );
      expect(content).toMatch(/never silently fall back/i);
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

    it("requires a down-port follow-up for non-integration environment bugs", () => {
      expect(content).toMatch(/non-integration environment branch/i);
      expect(content).toMatch(
        /forward cherry-picked down to the integration branch/i
      );
      expect(content).toMatch(/linked follow-up/i);
    });

    it("does not hardcode main as the PR base", () => {
      // The old linkage example hardcoded target_branch=main; it must now be
      // the env-resolved base.
      expect(content).not.toMatch(/target_branch=main\b/);
    });
  });
});

describe("config-resolution documents the forward env → base branch direction", () => {
  describe.each(RULE_ROOTS)("%s/config-resolution", root => {
    const referenceContent = readRule(root, "reference", "config-resolution");
    const eagerContent = readRule(root, "eager", "config-resolution");

    it("has an Env → base branch section in reference and eager rules", () => {
      expect(referenceContent).toContain("### Env → base branch");
      expect(referenceContent).toContain(ENV_FIELD);
      expect(referenceContent).toContain(DEPLOY_MAP);
      expect(eagerContent).toContain("## Env → base branch");
      expect(eagerContent).toContain(ENV_FIELD);
      expect(eagerContent).toContain(DEPLOY_MAP);
    });

    it("frames it as the inverse of the env-keyed done branch inference", () => {
      expect(referenceContent).toMatch(/forward/i);
      expect(referenceContent).toMatch(/inverse|reverse/i);
      expect(referenceContent).toMatch(/origin\/staging|staging work item/i);
    });

    it("documents unmapped reported env stop behavior and down-port follow-up", () => {
      expect(referenceContent).toMatch(/not present in `deploy\.branches`/i);
      expect(referenceContent).toMatch(/Do not silently default/i);
      expect(referenceContent).toMatch(/Forward cherry-pick/i);
      expect(eagerContent).toMatch(/absent from `deploy\.branches`/i);
      expect(eagerContent).toMatch(
        /cherry-picked down to the integration branch/i
      );
    });
  });
});

describe("pre-flight autofill extracts reported bug environments before defaults", () => {
  describe.each(RULE_ROOTS)("%s/pre-flight-autofill", root => {
    const referenceContent = readRule(root, "reference", "pre-flight-autofill");
    const eagerContent = readRule(root, "eager", "pre-flight-autofill");

    it("treats bare env names and env-bearing URLs as authorable Target Backend Environment inputs", () => {
      for (const content of [referenceContent, eagerContent]) {
        expect(content).toContain(ENV_FIELD);
        expect(content).toMatch(/bare environment names|bare words/i);
        expect(content).toContain("staging");
        expect(content).toContain("production");
        expect(content).toMatch(/gql\.staging|staging\.<domain>/);
      }
    });

    it("only recommends a default when no environment is discoverable", () => {
      for (const content of [referenceContent, eagerContent]) {
        expect(content).toMatch(/Only recommend/i);
        expect(content).toMatch(/no environment is discoverable/i);
        expect(content).toMatch(/assumption/i);
      }
    });
  });
});

describe("tracker agents preserve reported bug environment semantics", () => {
  describe.each(AGENT_ROOTS)("%s", root => {
    const agents = ["github-agent", "jira-agent", "linear-agent"] as const;

    it.each(agents)("%s parses reported bug envs before defaults", agent => {
      const content = readAgent(root, agent);
      expect(content).toMatch(/For bugs, parse the reported environment/i);
      expect(content).toMatch(/reported environment wins/i);
      expect(content).toMatch(/bare env names and env-bearing URLs/i);
    });

    it.each(agents)(
      "%s falls back to the default branch when no environment is reported",
      agent => {
        const content = readAgent(root, agent);
        expect(content).toMatch(/drives the implementation base branch/i);
        expect(content).toMatch(/no environment can be found anywhere/i);
        expect(content).toMatch(/fall back to the configured default branch/i);
        expect(content).toMatch(/record that assumption/i);
      }
    );

    it.each(agents)(
      "%s stops and reports the missing mapping and requires down-port follow-up",
      agent => {
        const content = readAgent(root, agent);
        expect(content).toMatch(/drives the implementation base branch/i);
        expect(content).toMatch(
          /stop and report the missing environment\/branch mapping/i
        );
        expect(content).toMatch(
          /forward cherry-picked down to the integration branch/i
        );
        expect(content).toMatch(/linked follow-up/i);
      }
    );
  });
});
