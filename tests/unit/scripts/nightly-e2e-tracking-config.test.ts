/**
 * RED contract for `.lisa.config.json` nightly-E2E tracking settings.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TRACKING_DESTINATIONS,
  loadTrackingModule,
  type TrackingDestination,
} from "../../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/** Project-owned provider blocks reused by the public tracking config. */
const PROVIDERS = Object.freeze({
  github: { org: "acme", repo: "widgets" },
  sentry: { org: "acme", project: "widgets" },
  jira: { project: "WID", issueType: "Bug" },
  atlassian: { site: "acme.atlassian.net", cloudId: "cloud-1" },
  linear: { workspace: "acme", teamKey: "WID" },
});

/**
 * Builds a config whose destination is the only new provider selector.
 *
 * @param destination - Public destination value
 * @returns Project config fixture
 */
function config(destination: TrackingDestination): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination } },
    ...PROVIDERS,
  };
}

describe("nightlyE2E.tracking.destination", () => {
  it.each(TRACKING_DESTINATIONS)("accepts exact %s", async destination => {
    const module = await loadTrackingModule(REPO_ROOT);
    const resolved = module.resolveNightlyTrackingConfig(config(destination));

    expect(resolved.destination).toBe(destination);
  });

  it.each([{}, { nightlyE2E: {} }, { nightlyE2E: { tracking: {} } }])(
    "defaults an absent selector to a green none skip",
    async raw => {
      const module = await loadTrackingModule(REPO_ROOT);

      expect(module.resolveNightlyTrackingConfig(raw)).toEqual({
        destination: "none",
        provider: null,
      });
    }
  );

  it.each([null, 17, true, [], "github", " GitHub ", "gitlab"])(
    "rejects ambiguous or unsupported selector %j",
    async destination => {
      const module = await loadTrackingModule(REPO_ROOT);
      const raw = { nightlyE2E: { tracking: { destination } } };

      expect(() => module.resolveNightlyTrackingConfig(raw)).toThrow(
        /nightlyE2E\.tracking\.destination.*github.*sentry.*jira.*linear.*none/i
      );
    }
  );

  it("reuses existing provider blocks instead of shadow copies", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const expected = {
      github: PROVIDERS.github,
      sentry: PROVIDERS.sentry,
      jira: {
        jira: PROVIDERS.jira,
        atlassian: PROVIDERS.atlassian,
      },
      linear: PROVIDERS.linear,
    } as const;

    for (const destination of ["github", "sentry", "jira", "linear"] as const) {
      const resolved = module.resolveNightlyTrackingConfig(config(destination));
      expect(resolved.provider).toEqual(expected[destination]);
    }
  });

  it.each([
    { nightlyE2E: null },
    { nightlyE2E: [] },
    { nightlyE2E: { tracking: null } },
    { nightlyE2E: { tracking: "github" } },
  ])("fails closed on a malformed explicit config block %#", async raw => {
    const module = await loadTrackingModule(REPO_ROOT);

    expect(() => module.resolveNightlyTrackingConfig(raw)).toThrow(
      /nightlyE2E.*object|tracking.*object/i
    );
  });

  it.each([
    ["github", { github: undefined }, "github"],
    ["github", { github: {} }, "github.org"],
    ["github", { github: { org: "acme" } }, "github.repo"],
    ["github", { github: { org: 17, repo: "widgets" } }, "github.org"],
    ["sentry", { sentry: undefined }, "sentry"],
    ["sentry", { sentry: { project: "widgets" } }, "sentry.org"],
    ["sentry", { sentry: { org: "acme" } }, "sentry.project"],
    ["sentry", { sentry: { org: "acme", project: 17 } }, "sentry.project"],
    ["jira", { jira: undefined }, "jira"],
    ["jira", { jira: {} }, "jira.project"],
    ["jira", { jira: { project: 17 } }, "jira.project"],
    ["jira", { atlassian: undefined }, "atlassian"],
    ["jira", { atlassian: {} }, "atlassian.site"],
    ["jira", { atlassian: { site: 17 } }, "atlassian.site"],
    ["linear", { linear: undefined }, "linear"],
    ["linear", { linear: {} }, "linear.teamKey"],
    ["linear", { linear: { teamKey: 17 } }, "linear.teamKey"],
  ] as const)(
    "%s refuses an absent or malformed selected provider field %#",
    async (destination, replacement, field) => {
      const module = await loadTrackingModule(REPO_ROOT);
      const raw = { ...config(destination), ...replacement };

      expect(() => module.resolveNightlyTrackingConfig(raw)).toThrow(field);
    }
  );

  it("bounds diagnostics and never echoes raw credentials", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const secret = "TRACKING_TOKEN_SECRET_SENTINEL";
    const raw = {
      nightlyE2E: { tracking: { destination: `${secret}${"x".repeat(9000)}` } },
      linear: { teamKey: secret },
    };

    let message = "";
    try {
      module.resolveNightlyTrackingConfig(raw);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).not.toContain(secret);
  });
});
