/**
 * Contract tests for configuration validation.
 *
 * These blocks are read by shell, by Node, and by generated workflows, so a
 * malformed one surfaces late and somewhere unhelpful — a container failing
 * mid-setup, a scheduled loop that never fires, a dispatch naming a surface
 * nobody provisioned. Every case below is one of those turned into a message
 * at doctor time instead.
 * @module tests/unit/secrets/validate-config
 */
import { describe, expect, it } from "vitest";

import {
  validateAutomations,
  validateConfig,
  validateRemoteEnv,
  validateSecrets,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

/** A provisioned surface, so automation checks have something to point at. */
const PROVISIONED = {
  surfaces: { "codex-cloud": { repository: "org/repo" } },
};

describe("secrets block", () => {
  it("accepts an absent block, since a manager is never required", () => {
    expect(validateSecrets(undefined)).toEqual([]);
  });

  it("rejects a namespace that could redirect writes", () => {
    const problems = validateSecrets({
      provider: "env",
      namespace: "../escape",
    });
    expect(problems[0]).toMatch(/one safe path segment/i);
  });

  it("flags a documented-but-unimplemented provider distinctly from an unknown one", () => {
    // Claiming support that does not exist is worse than admitting the gap.
    expect(validateSecrets({ provider: "vault" })[0]).toMatch(
      /no read implementation yet/i
    );
    expect(validateSecrets({ provider: "invented" })[0]).toMatch(/is unknown/i);
  });

  it("rejects a non-exact key name in require or rotating", () => {
    const problems = validateSecrets({
      provider: "env",
      require: ["attio-prod"],
    });
    expect(problems[0]).toMatch(/never fuzzy/i);
  });

  it("rejects rotating declared with no bootstrap to write back with", () => {
    // The replacement could not be persisted, so the credential is stranded the
    // first time it is used.
    const problems = validateSecrets({ provider: "env", rotating: ["TOKEN"] });
    expect(problems.at(-1)).toMatch(/stranded/i);
  });

  it("accepts rotating once a bootstrap exists", () => {
    const problems = validateSecrets({
      provider: "bitwarden",
      rotating: ["TOKEN"],
      bootstrap: { key: "BWS_ACCESS_TOKEN" },
    });
    expect(problems).toEqual([]);
  });

  it("rejects a non-array require", () => {
    expect(validateSecrets({ provider: "env", require: "A_KEY" })[0]).toMatch(
      /must be an array/i
    );
  });
});

describe("remoteEnv block", () => {
  it("accepts an absent block", () => {
    expect(validateRemoteEnv(undefined)).toEqual([]);
  });

  it("rejects an archive install with no checksum", () => {
    const problems = validateRemoteEnv({
      tools: {
        install: [
          {
            name: "bws",
            version: "2.1.0",
            install: "release-zip",
            url: "https://x",
          },
        ],
      },
    });
    expect(problems[0]).toMatch(/whatever the URL serves today/i);
  });

  it("rejects an unpinned install", () => {
    const problems = validateRemoteEnv({
      tools: {
        install: [{ name: "bws", install: "npm-global", package: "p" }],
      },
    });
    expect(problems[0]).toMatch(/no pinned version/i);
  });

  it("rejects an unknown install method", () => {
    const problems = validateRemoteEnv({
      tools: { install: [{ name: "x", version: "1", install: "curl-bash" }] },
    });
    expect(problems[0]).toMatch(/Supported: release-zip, npm-global/);
  });

  it("requires a Claude surface to name its routine, not a repository", () => {
    // A Claude cloud environment is account-scoped configuration and carries no
    // repository at all — the repository arrives per session — so demanding one
    // would ask for a field that cannot be true. The routine is the handle.
    const problems = validateRemoteEnv({
      surfaces: { "claude-web": { repository: "org/repo" } },
    });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/has no routineId/);
    expect(problems.join("\n")).toMatch(/has no fireUrl/);
  });

  it("accepts a Claude surface bound to a routine", () => {
    const problems = validateRemoteEnv({
      surfaces: {
        "claude-web": {
          routineId: "trig_01ABC",
          fireUrl: "https://api.anthropic.com/v1/claude_code/routines/x/fire",
        },
      },
    });
    expect(problems).toEqual([]);
  });

  it("knows every surface the resolver knows", () => {
    // The two lists used to be restated independently, so a surface could be
    // added to the resolver and still be called unknown by doctor.
    const problems = validateRemoteEnv({
      surfaces: { "claude-web": { routineId: "r", fireUrl: "u" } },
    });
    expect(problems.join("\n")).not.toMatch(/unknown surface/i);
  });

  it("rejects a surface declared without a repository", () => {
    const problems = validateRemoteEnv({ surfaces: { "codex-cloud": {} } });
    expect(problems[0]).toMatch(/has no repository/i);
  });

  it("accepts a fully pinned, checksummed toolchain", () => {
    const problems = validateRemoteEnv({
      tools: {
        require: [{ name: "node", minVersion: "20" }],
        install: [
          {
            name: "bws",
            version: "2.1.0",
            install: "release-zip",
            url: "https://x",
            sha256: "abc",
          },
        ],
      },
      ...PROVISIONED,
    });
    expect(problems).toEqual([]);
  });
});

describe("automations block", () => {
  const loop = {
    scheduler: "github-actions",
    schedule: "17 * * * *",
    executionEnv: "codex-cloud",
  };

  it("ignores loops that do not use the generated scheduler", () => {
    const problems = validateAutomations(
      { intake: { scheduler: "native" } },
      undefined
    );
    expect(problems).toEqual([]);
  });

  it("rejects a loop dispatching to an unprovisioned surface", () => {
    // Otherwise the failure appears at 3am, in a log nobody is watching.
    const problems = validateAutomations({ intake: loop }, undefined);
    expect(problems[0]).toMatch(/setup:remote-env codex-cloud/);
  });

  it("rejects a loop with no schedule", () => {
    const { schedule, ...noSchedule } = loop;
    const problems = validateAutomations({ intake: noSchedule }, PROVISIONED);
    expect(problems[0]).toMatch(/no schedule/i);
  });

  it("accepts a loop whose surface is provisioned", () => {
    expect(validateAutomations({ intake: loop }, PROVISIONED)).toEqual([]);
  });

  it("accepts a claude-web loop bound to a routine rather than a repository", () => {
    // This is the path that actually gates dispatch, and it asks a different
    // question of each surface: demanding a repository here would reject a
    // correctly provisioned Claude surface, which has none to give.
    const claudeLoop = { ...loop, executionEnv: "claude-web" };
    const provisioned = {
      surfaces: {
        "claude-web": {
          routineId: "trig_01ABC",
          fireUrl: "https://api.anthropic.com/v1/claude_code/routines/x/fire",
        },
      },
    };
    expect(validateAutomations({ intake: claudeLoop }, provisioned)).toEqual(
      []
    );
  });

  it("rejects a claude-web loop whose routine was never recorded", () => {
    const claudeLoop = { ...loop, executionEnv: "claude-web" };
    const halfProvisioned = {
      surfaces: { "claude-web": { routineId: "trig_01ABC" } },
    };
    const problems = validateAutomations(
      { intake: claudeLoop },
      halfProvisioned
    );
    expect(problems[0]).toMatch(/setup:remote-env claude-web/);
  });
});

describe("whole-config validation", () => {
  it("reports problems from every block at once", () => {
    const problems = validateConfig({
      secrets: { provider: "invented" },
      remoteEnv: { surfaces: { "codex-cloud": {} } },
      automations: {
        intake: { scheduler: "github-actions", schedule: "* * * * *" },
      },
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("passes a config using none of these blocks", () => {
    expect(validateConfig({ tracker: "github" })).toEqual([]);
  });
});
