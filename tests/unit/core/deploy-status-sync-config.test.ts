import { describe, expect, it } from "vitest";
import {
  doneMapPath,
  ENV_DONE_LABEL_DEFAULTS,
  JIRA_DONE_STATUS_DEFAULTS,
  validateDeployStatusSyncConfig,
} from "../../../src/core/deploy-status-sync.js";
import { validateProjectConfig } from "../../../src/core/project-config.js";

const SOURCE = ".lisa.config.json";
const LINEAR_BINDING_ERROR =
  'Invalid deployStatusSync.linearBinding in .lisa.config.json: expected "labels" or "states"';

describe("default done vocabularies", () => {
  it("exports the shared label defaults consumed by the sync registry", () => {
    expect(ENV_DONE_LABEL_DEFAULTS).toEqual({
      dev: "status:on-dev",
      staging: "status:on-stg",
      production: "status:done",
    });
    expect(JIRA_DONE_STATUS_DEFAULTS).toEqual({
      dev: "On Dev",
      staging: "On Stg",
      production: "Done",
    });
  });

  it("exposes each tracker's done-map config path", () => {
    expect(doneMapPath("github")).toBe("github.labels.build.done");
    expect(doneMapPath("linear")).toBe("linear.labels.build.done");
    expect(doneMapPath("jira")).toBe("jira.workflow.done");
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

  it.each([["gold"], [null], [["labels"]]])(
    "rejects non-object section %#",
    section => {
      expect(() => validateDeployStatusSyncConfig(section, SOURCE)).toThrow(
        "Invalid deployStatusSync in .lisa.config.json: expected an object"
      );
    }
  );

  it("rejects an unknown linearBinding value", () => {
    expect(() =>
      validateDeployStatusSyncConfig({ linearBinding: "webhooks" }, SOURCE)
    ).toThrow(LINEAR_BINDING_ERROR);
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

  it.each([["ids"], [["a"]], [null]])(
    "rejects non-object provisioned %#",
    provisioned => {
      expect(() =>
        validateDeployStatusSyncConfig({ provisioned }, SOURCE)
      ).toThrow(
        "Invalid deployStatusSync.provisioned in .lisa.config.json: expected an object"
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

  it.each([[""], ["  padded  "]])("rejects invalid tier %#", tier => {
    expect(() => validateDeployStatusSyncConfig({ tier }, SOURCE)).toThrow(
      "Invalid deployStatusSync.tier in .lisa.config.json: expected a non-empty string"
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
    ).toThrow(LINEAR_BINDING_ERROR);
  });
});
