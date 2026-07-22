import { describe, expect, it } from "vitest";
import { resolveDeployLadder } from "../../../src/core/deploy-status-sync.js";
import type { JsonValue } from "../../../src/sync/json-path.js";

const SOURCE = ".lisa.config.json";

// Hardcoded expected error text — never computed from the module under test.
const STAGING_WITHOUT_BRANCH_ERROR =
  'Invalid deploy configuration in .lisa.config.json: a done status ("status:on-stg") is configured for environment "staging", but deploy.branches has no "staging" entry. Add deploy.branches.staging (the git branch that deploys to staging) or remove "staging" from the done map.';

describe("resolveDeployLadder errors", () => {
  it("rejects a configured done status whose environment has no branch", () => {
    const config: JsonValue = {
      deploy: { branches: { dev: "dev", production: "main" } },
      github: { labels: { build: { done: { staging: "status:on-stg" } } } },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      STAGING_WITHOUT_BRANCH_ERROR
    );
  });

  it("rejects a configured production done entry beside branches.prod (both spellings block the alias)", () => {
    const config: JsonValue = {
      deploy: { branches: { prod: "main" } },
      github: { labels: { build: { done: { production: "status:done" } } } },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      'Invalid deploy configuration in .lisa.config.json: a done status ("status:done") is configured for environment "production", but deploy.branches has no "production" entry. Add deploy.branches.production (the git branch that deploys to production) or remove "production" from the done map.'
    );
  });

  it("rejects a non-string branch value by erroring its configured done entry", () => {
    const config: JsonValue = {
      deploy: { branches: { dev: "dev", staging: 42, production: "main" } },
      github: { labels: { build: { done: { staging: "status:on-stg" } } } },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      STAGING_WITHOUT_BRANCH_ERROR
    );
  });

  it("rejects deploy.order whose env set differs from deploy.branches", () => {
    const config: JsonValue = {
      deploy: {
        branches: { dev: "dev", staging: "staging", production: "main" },
        order: ["dev", "production"],
      },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      "Invalid deploy.order in .lisa.config.json: its environment names must exactly match the keys of deploy.branches. deploy.order has [dev, production]; deploy.branches has [dev, staging, production]."
    );
  });

  it("rejects deploy.order containing duplicate environment names", () => {
    const config: JsonValue = {
      deploy: {
        branches: { dev: "dev", production: "main" },
        order: ["dev", "dev", "production"],
      },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      "Invalid deploy.order in .lisa.config.json: its environment names must exactly match the keys of deploy.branches. deploy.order has [dev, dev, production]; deploy.branches has [dev, production]."
    );
  });

  it("rejects a prod-spelled deploy.order against production-spelled branches (no aliasing)", () => {
    const config: JsonValue = {
      deploy: { branches: { production: "main" }, order: ["prod"] },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      "Invalid deploy.order in .lisa.config.json: its environment names must exactly match the keys of deploy.branches. deploy.order has [prod]; deploy.branches has [production]."
    );
  });

  it("rejects a non-string deploy.order entry decision-readably", () => {
    const config: JsonValue = {
      deploy: {
        branches: { dev: "dev", production: "main" },
        order: ["dev", 2, "production"],
      },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      "Invalid deploy.order in .lisa.config.json: every entry must be an environment name string; found 2."
    );
  });

  it("rejects an unorderable custom environment when deploy.order is absent", () => {
    const config: JsonValue = {
      deploy: { branches: { dev: "dev", qa: "qa" } },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      'Invalid deploy configuration in .lisa.config.json: cannot order environment "qa". Set deploy.order (environments listed lowest first, e.g. ["dev","staging","production"]) so Lisa knows the promotion order.'
    );
  });
});
