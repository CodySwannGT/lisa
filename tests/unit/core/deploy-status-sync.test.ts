import { describe, expect, it } from "vitest";
import {
  ENV_DONE_LABEL_DEFAULTS,
  JIRA_DONE_STATUS_DEFAULTS,
  resolveDeployLadder,
  validateDeployStatusSyncConfig,
} from "../../../src/core/deploy-status-sync.js";
import { validateProjectConfig } from "../../../src/core/project-config.js";
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

describe("default done vocabularies", () => {
  it("exports the shared label defaults consumed by the sync registry", () => {
    expect(ENV_DONE_LABEL_DEFAULTS).toEqual({
      dev: DEV_LABEL,
      staging: STAGING_LABEL,
      production: PRODUCTION_LABEL,
    });
    expect(JIRA_DONE_STATUS_DEFAULTS).toEqual({
      dev: "On Dev",
      staging: "On Stg",
      production: "Done",
    });
  });
});

describe("resolveDeployLadder", () => {
  it("returns the ordered 3-env ladder from label defaults for github", () => {
    expect(resolveDeployLadder(FULL_BRANCHES, "github", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
        { env: "staging", branch: STAGING_BRANCH, doneStatus: STAGING_LABEL },
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: false,
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
    });
  });

  it("rejects a configured done status whose environment has no branch", () => {
    const config: JsonValue = {
      deploy: { branches: { dev: "dev", production: "main" } },
      github: { labels: { build: { done: { staging: STAGING_LABEL } } } },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      'Invalid deploy configuration in .lisa.config.json: a done status ("status:on-stg") is configured for environment "staging", but deploy.branches has no "staging" entry. Add deploy.branches.staging (the git branch that deploys to staging) or remove "staging" from the done map.'
    );
  });

  it("collapses a production-only config to a single terminal-only rung", () => {
    const config: JsonValue = { deploy: { branches: { production: "main" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: true,
    });
  });

  it("joins branches.prod with the default production done entry via the sole alias", () => {
    const config: JsonValue = { deploy: { branches: { prod: "main" } } };
    expect(resolveDeployLadder(config, "github", SOURCE)).toEqual({
      rungs: [{ env: "prod", branch: "main", doneStatus: PRODUCTION_LABEL }],
      terminalOnly: true,
    });
    expect(resolveDeployLadder(config, "jira", SOURCE)).toEqual({
      rungs: [{ env: "prod", branch: "main", doneStatus: "Done" }],
      terminalOnly: true,
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
    });
  });

  it("rejects deploy.order whose env set differs from deploy.branches", () => {
    const config: JsonValue = {
      deploy: { ...FULL_BRANCHES.deploy, order: ["dev", "production"] },
    };
    expect(() => resolveDeployLadder(config, "github", SOURCE)).toThrow(
      "Invalid deploy.order in .lisa.config.json: its environment names must exactly match the keys of deploy.branches. deploy.order has [dev, production]; deploy.branches has [dev, staging, production]."
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

  it("binds a string-valued done to the terminal rung only", () => {
    const config: JsonValue = {
      deploy: {
        branches: { dev: "dev", staging: STAGING_BRANCH, production: "main" },
      },
      jira: { workflow: { done: "Shipped" } },
    };
    expect(resolveDeployLadder(config, "jira", SOURCE)).toEqual({
      rungs: [
        { env: "dev", branch: "dev", doneStatus: "On Dev" },
        { env: "staging", branch: STAGING_BRANCH, doneStatus: "On Stg" },
        { env: "production", branch: "main", doneStatus: "Shipped" },
      ],
      terminalOnly: false,
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
    });
  });
});

describe("validateDeployStatusSyncConfig", () => {
  it("returns the typed section for a fully valid value", () => {
    expect(
      validateDeployStatusSyncConfig(
        {
          tier: "team",
          provisioned: { "jira:On Dev": "10012" },
          linearBinding: "labels",
          verifiedAt: "2026-07-01T12:00:00Z",
        },
        SOURCE
      )
    ).toEqual({
      tier: "team",
      provisioned: { "jira:On Dev": "10012" },
      linearBinding: "labels",
      verifiedAt: "2026-07-01T12:00:00Z",
    });
  });

  it("passes undefined through and accepts an empty section", () => {
    expect(validateDeployStatusSyncConfig(undefined, SOURCE)).toBeUndefined();
    expect(validateDeployStatusSyncConfig({}, SOURCE)).toEqual({});
  });

  it("rejects a non-object section", () => {
    expect(() => validateDeployStatusSyncConfig("gold", SOURCE)).toThrow(
      "Invalid deployStatusSync in .lisa.config.json: expected an object"
    );
  });

  it("rejects an unknown linearBinding value", () => {
    expect(() =>
      validateDeployStatusSyncConfig({ linearBinding: "webhooks" }, SOURCE)
    ).toThrow(
      'Invalid deployStatusSync.linearBinding in .lisa.config.json: expected "labels" or "states"'
    );
  });

  it.each(["2026-07-01", "2026-13-01T00:00:00Z", "2026-07-01T12:00:00+00:00"])(
    "rejects non-ISO-8601-UTC verifiedAt %s",
    verifiedAt => {
      expect(() =>
        validateDeployStatusSyncConfig({ verifiedAt }, SOURCE)
      ).toThrow(
        "Invalid deployStatusSync.verifiedAt in .lisa.config.json: expected an ISO-8601 UTC timestamp (e.g. 2026-01-01T00:00:00Z)"
      );
    }
  );

  it("rejects a non-string provisioned id", () => {
    expect(() =>
      validateDeployStatusSyncConfig(
        { provisioned: { "jira:Done": 10001 } },
        SOURCE
      )
    ).toThrow(
      "Invalid deployStatusSync.provisioned.jira:Done in .lisa.config.json: expected a non-empty string"
    );
  });
});

describe("project config deployStatusSync wiring", () => {
  it("parses the section beside the other validated sections", () => {
    expect(
      validateProjectConfig({ deployStatusSync: { tier: "team" } }, SOURCE)
    ).toMatchObject({ deployStatusSync: { tier: "team" } });
  });

  it("rejects an invalid nested section during parse", () => {
    expect(() =>
      validateProjectConfig(
        { deployStatusSync: { linearBinding: "webhooks" } },
        SOURCE
      )
    ).toThrow(
      'Invalid deployStatusSync.linearBinding in .lisa.config.json: expected "labels" or "states"'
    );
  });
});
