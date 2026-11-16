/**
 * Remote setup follows the project's CONFIGURED secrets provider.
 *
 * `setup-remote-env.mjs` used to pick the credential-manager CLI from
 * environment variables alone and fall back to Bitwarden, never reading
 * `.lisa.config.json` `secrets.provider`. A Doppler project was told to export
 * a Bitwarden variable and given `bws`; an env-only project was given a vendor
 * CLI it never asked for. The provider is now resolved as: explicit flag, then
 * exactly what the `lisa-secrets-access` runtime (`readConfig`) will use — the
 * committed `.lisa.config.json` when one exists (the runtime reads neither
 * `.lisa.config.local.json` nor `LISA_PROVIDER` then), otherwise the
 * repo-less environment convention. Every source is validated against the
 * known provider list, because the name is printed into shell the operator
 * pastes.
 * @module tests/unit/secrets/remote-env-configured-provider
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  SETUP_FIELD,
  assertProviderCliReady,
  emitClaudeWeb,
  emitContainer,
  ensureProviderCli,
  resolveEmitTarget,
  resolveSecretsProvider,
  workstationProviderFor,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The tenant flag every emit case passes. */
const TENANT_FLAG = "--tenant=acme";

/** The committed config layer. */
const COMMITTED = ".lisa.config.json";

/** A throwaway project root, bounded by a `.git` so the walk stops here. */
let root: string;

/**
 * Write a config layer into the throwaway project.
 * @param name - File name, committed or local.
 * @param body - JSON body.
 */
const writeLayer = (name: string, body: unknown): void => {
  writeFileSync(path.join(root, name), JSON.stringify(body));
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-provider-"));
  writeFileSync(path.join(root, ".git"), "gitdir: elsewhere\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSecretsProvider", () => {
  it("uses the configured provider when nothing overrides it", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({ argv: [], env: {}, cwd: root })
    ).resolves.toStrictEqual({ provider: "doppler", source: "config" });
  });

  it("falls back to the documented default when the config names none", async () => {
    // `env` is the secrets contract's own default: the environment IS the
    // provider, and no vendor CLI is implied.
    writeLayer(COMMITTED, { tracker: "github" });

    await expect(
      resolveSecretsProvider({ argv: [], env: {}, cwd: root })
    ).resolves.toStrictEqual({ provider: "env", source: "default" });
  });

  it("ignores the local config, exactly as the runtime does", async () => {
    // `readConfig` reads only the committed file. A setup that honoured the
    // local layer would install a CLI the runtime never uses.
    writeLayer(COMMITTED, { secrets: { provider: "bitwarden" } });
    writeLayer(".lisa.config.local.json", { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({ argv: [], env: {}, cwd: root })
    ).resolves.toStrictEqual({ provider: "bitwarden", source: "config" });
  });

  it("ignores LISA_PROVIDER when a config exists, exactly as the runtime does", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({
        argv: [],
        env: { LISA_PROVIDER: "1password", LISA_TENANT: "acme" },
        cwd: root,
      })
    ).resolves.toStrictEqual({ provider: "doppler", source: "config" });
  });

  it("uses LISA_PROVIDER for a repo-less tenant, as the runtime does", async () => {
    await expect(
      resolveSecretsProvider({
        argv: [],
        env: { LISA_PROVIDER: "1password", LISA_TENANT: "acme" },
        cwd: root,
      })
    ).resolves.toStrictEqual({ provider: "1password", source: "environment" });
  });

  it("lets an explicit flag beat the config (operator intent)", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({
        argv: ["--provider=vault"],
        env: { LISA_PROVIDER: "1password" },
        cwd: root,
      })
    ).resolves.toStrictEqual({ provider: "vault", source: "flag" });
  });
});

/** The plain-English refusal every unknown provider earns. */
const REFUSED = /not a secrets provider Lisa knows/;

describe("resolveSecretsProvider refuses a provider it does not know", () => {
  const BAD = ["nosuchvault", "bitwarden;touch /tmp/pwn", "$(id)", "none"];

  it.each(BAD)("from the flag: %s", async bad => {
    await expect(
      resolveSecretsProvider({
        argv: [`--provider=${bad}`],
        env: {},
        cwd: root,
      })
    ).rejects.toThrow(REFUSED);
  });

  it.each(BAD)("from the environment: %s", async bad => {
    await expect(
      resolveSecretsProvider({
        argv: [],
        env: { LISA_PROVIDER: bad, LISA_TENANT: "acme" },
        cwd: root,
      })
    ).rejects.toThrow(REFUSED);
  });

  it.each(BAD)("from the config: %s", async bad => {
    writeLayer(COMMITTED, { secrets: { provider: bad } });

    await expect(
      resolveSecretsProvider({ argv: [], env: {}, cwd: root })
    ).rejects.toThrow(REFUSED);
  });

  it("before any of it can reach the emitted shell", async () => {
    writeLayer(COMMITTED, {
      secrets: { provider: "bitwarden;touch /tmp/pwn" },
    });

    await expect(resolveEmitTarget([TENANT_FLAG], {}, root)).rejects.toThrow(
      REFUSED
    );
  });
});

describe("a repo-less setup emitted with no provider configured", () => {
  it("never hands `env` to the workstation bootstrap", async () => {
    // A config that names no provider resolves to the runtime default, `env`.
    writeLayer(COMMITTED, { tracker: "github" });
    const identity = await resolveEmitTarget([TENANT_FLAG], {}, root);
    const exported =
      /export LISA_PROVIDER=(\S+)/.exec(emitClaudeWeb(identity))?.[1] ?? "";
    expect(exported).toBe("env");

    const bin = path.join(root, "bin");
    const home = path.join(root, "home");
    const work = path.join(root, "work");
    const log = path.join(root, "npx.log");
    mkdirSync(bin);
    mkdirSync(home);
    mkdirSync(work);
    // A stub `npx` that records each invocation and succeeds.
    writeFileSync(path.join(bin, "npx"), `#!/bin/sh\necho "$*" >> "${log}"\n`);
    chmodSync(path.join(bin, "npx"), 0o755);

    const run = boundedSpawnSync({
      command: "bash",
      args: ["-c", SETUP_FIELD],
      cwd: work,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        LISA_TENANT: "acme",
        LISA_PROVIDER: exported,
      },
      label: "setup field with the emitted provider",
    });

    expect(run.status).toBe(0);
    const calls = readFileSync(log, "utf8")
      .split("\n")
      .filter(line => line.includes("workstation"));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).not.toContain("--provider=env");
      expect(call).toContain("--provider=none");
    }
  });
});

describe("assertProviderCliReady", () => {
  const missing = { name: "doppler", action: "install", reason: "not found" };

  it("throws on a remote surface when the configured CLI is missing", () => {
    expect(() =>
      assertProviderCliReady(missing, {
        provider: "doppler",
        remote: true,
        dryRun: false,
      })
    ).toThrow(/the configured secrets provider "doppler" needs doppler/);
  });

  it("does not throw locally, on a dry run, or when the CLI is present", () => {
    expect(() =>
      assertProviderCliReady(missing, {
        provider: "doppler",
        remote: false,
        dryRun: false,
      })
    ).not.toThrow();
    expect(() =>
      assertProviderCliReady(missing, {
        provider: "doppler",
        remote: true,
        dryRun: true,
      })
    ).not.toThrow();
    expect(() =>
      assertProviderCliReady(
        { ...missing, action: "installed" },
        { provider: "doppler", remote: true, dryRun: false }
      )
    ).not.toThrow();
  });
});

describe("resolveEmitTarget with a configured provider", () => {
  it("names the configured provider's bootstrap variable", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveEmitTarget([TENANT_FLAG], {}, root)
    ).resolves.toMatchObject({
      provider: "doppler",
      bootstrapKey: "DOPPLER_TOKEN_acme",
    });
  });
});

describe("workstationProviderFor", () => {
  it("maps the secrets `env` provider to the catalogue's `none`", () => {
    expect(workstationProviderFor("env")).toBe("none");
    expect(workstationProviderFor("doppler")).toBe("doppler");
  });
});

describe("emitContainer", () => {
  it("never defaults the Dockerfile to a vendor", () => {
    expect(emitContainer({ bootstrapKey: null })).not.toContain(
      "--provider=bitwarden"
    );
    expect(emitContainer({ bootstrapKey: null, provider: "env" })).toContain(
      "--provider=none"
    );
  });
});

describe("ensureProviderCli", () => {
  it("verifies the configured provider's binary, not Bitwarden's", async () => {
    const probed: string[] = [];
    const row = await ensureProviderCli("doppler", {
      deps: {
        locate: (name: string) => {
          probed.push(name);
          return "/usr/local/bin/doppler";
        },
        version: () => "v3",
      },
    });

    expect(probed).toStrictEqual(["doppler"]);
    expect((row as { action?: unknown }).action).toBe("present");
  });

  it("plans, but does not run, an install without consent", async () => {
    const ran: string[] = [];
    const row = await ensureProviderCli("doppler", {
      consent: false,
      deps: {
        locate: () => null,
        run: (cmd: string) => {
          ran.push(cmd);
          return "";
        },
      },
    });

    expect((row as { action?: unknown }).action).toBe("install");
    expect(ran).toStrictEqual([]);
  });

  it("treats the env provider as needing no CLI", async () => {
    const row = await ensureProviderCli("env", {
      deps: { locate: () => null },
    });

    expect(row).toMatchObject({ name: "none", action: "present" });
  });
});
