import { describe, expect, it } from "vitest";
import { resolveDeployLadder } from "../../../src/core/deploy-status-sync.js";
import type { JsonValue } from "../../../src/sync/json-path.js";

const SOURCE = ".lisa.config.json";

// Hardcoded known values — never computed from the module under test.
const DEV_LABEL = "status:on-dev";
const STAGING_LABEL = "status:on-stg";
const PRODUCTION_LABEL = "status:done";
const STAGING_BRANCH = "staging";
const LIVE_LABEL = "status:live";

const FULL_BRANCHES = {
  deploy: {
    branches: { dev: "dev", staging: STAGING_BRANCH, production: "main" },
  },
} satisfies JsonValue;

describe("resolveDeployLadder", () => {
  it("returns the ordered 3-env ladder from label defaults for github", () => {
    expect(resolveDeployLadder(FULL_BRANCHES, "github", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
        { env: "staging", branch: STAGING_BRANCH, doneStatus: STAGING_LABEL },
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("sources jira done statuses, configured entries winning over defaults", () => {
    const config: JsonValue = {
      ...FULL_BRANCHES,
      jira: { workflow: { done: { dev: "Deployed Dev" } } },
    };
    expect(resolveDeployLadder(config, "jira", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: "Deployed Dev" },
        { env: "staging", branch: STAGING_BRANCH, doneStatus: "On Stg" },
        { env: "production", branch: "main", doneStatus: "Done" },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("sources linear done labels from linear.labels.build.done", () => {
    const config: JsonValue = {
      ...FULL_BRANCHES,
      linear: {
        labels: {
          build: {
            done: {
              dev: "status:dev-live",
              staging: "status:stg-live",
              production: LIVE_LABEL,
            },
          },
        },
      },
    };
    expect(resolveDeployLadder(config, "linear", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: "status:dev-live" },
        {
          env: "staging",
          branch: STAGING_BRANCH,
          doneStatus: "status:stg-live",
        },
        { env: "production", branch: "main", doneStatus: LIVE_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("collapses a production-only config to a single terminal-only rung", () => {
    const config: JsonValue = { deploy: { branches: { production: "main" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: true,
      terminalEnv: "production",
    });
  });

  it("flags a solo dev universe terminal-only (dev is its own terminal)", () => {
    const config: JsonValue = { deploy: { branches: { dev: "trunk" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [{ env: "dev", branch: "trunk", doneStatus: DEV_LABEL }],
      terminalOnly: true,
      terminalEnv: "dev",
    });
  });

  it("does NOT flag terminal-only when the sole rung is not the highest env", () => {
    const config: JsonValue = {
      deploy: { branches: { dev: "dev", qa: "qa" }, order: ["dev", "qa"] },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [{ env: "dev", branch: "dev", doneStatus: DEV_LABEL }],
      terminalOnly: false,
      terminalEnv: "qa",
    });
  });

  it("joins branches.prod with the default production done entry via the sole alias", () => {
    const config: JsonValue = { deploy: { branches: { prod: "main" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [{ env: "prod", branch: "main", doneStatus: PRODUCTION_LABEL }],
      terminalOnly: true,
      terminalEnv: "prod",
    });
    expect(resolveDeployLadder(config, "jira", SOURCE)).toEqual({
      rungs: [{ env: "prod", branch: "main", doneStatus: "Done" }],
      terminalOnly: true,
      terminalEnv: "prod",
    });
  });

  it("ranks an aliased prod through canonical ordering in a 2-env ladder", () => {
    const config: JsonValue = {
      deploy: { branches: { prod: "main", dev: "dev" } },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
        { env: "prod", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "prod",
    });
  });

  it("does not alias when both prod and production are configured", () => {
    const config: JsonValue = {
      deploy: {
        branches: { prod: "release", production: "main" },
        order: ["prod", "production"],
      },
      github: {
        labels: {
          build: {
            done: { prod: "status:on-prod", production: PRODUCTION_LABEL },
          },
        },
      },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "prod", branch: "release", doneStatus: "status:on-prod" },
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("respects deploy.order over key order and canonical ranking", () => {
    const config: JsonValue = {
      deploy: {
        branches: { production: "main", qa: "qa", dev: "dev" },
        order: ["dev", "qa", "production"],
      },
      github: { labels: { build: { done: { qa: "status:on-qa" } } } },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
        { env: "qa", branch: "qa", doneStatus: "status:on-qa" },
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("skips a custom-env rung that has a branch but no done status", () => {
    const config: JsonValue = {
      deploy: {
        branches: { dev: "dev", qa: "qa", production: "main" },
        order: ["dev", "qa", "production"],
      },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("returns an empty ladder when deploy is absent or has no branches", () => {
    expect(resolveDeployLadder({}, "github", SOURCE)).toEqual({
      rungs: [],
      terminalOnly: false,
    });
    expect(resolveDeployLadder({ deploy: {} }, "jira", SOURCE)).toEqual({
      rungs: [],
      terminalOnly: false,
    });
  });

  it("returns an empty ladder for a single custom env with no done vocabulary", () => {
    const config: JsonValue = { deploy: { branches: { edge: "main" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [],
      terminalOnly: false,
      terminalEnv: "edge",
    });
  });

  it("binds a string-valued done to the terminal rung only", () => {
    const config: JsonValue = {
      ...FULL_BRANCHES,
      jira: { workflow: { done: "Shipped" } },
    };
    expect(resolveDeployLadder(config, "jira", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: "On Dev" },
        { env: "staging", branch: STAGING_BRANCH, doneStatus: "On Stg" },
        { env: "production", branch: "main", doneStatus: "Shipped" },
      ],
      terminalOnly: false,
      terminalEnv: "production",
    });
  });

  it("allows a single custom environment with a configured done status", () => {
    const config: JsonValue = {
      deploy: { branches: { edge: "main" } },
      github: { labels: { build: { done: { edge: LIVE_LABEL } } } },
    };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [{ env: "edge", branch: "main", doneStatus: LIVE_LABEL }],
      terminalOnly: true,
      terminalEnv: "edge",
    });
  });
});
