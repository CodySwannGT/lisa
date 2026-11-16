/**
 * Remote setup follows the project's CONFIGURED secrets provider.
 *
 * `setup-remote-env.mjs` used to pick the credential-manager CLI from
 * environment variables alone and fall back to Bitwarden, never reading
 * `.lisa.config.json` `secrets.provider`. A Doppler project was told to export
 * a Bitwarden variable and given `bws`; an env-only project was given a vendor
 * CLI it never asked for. The provider is now resolved as: explicit flag, then
 * the provider environment variables, then the merged config
 * (`.lisa.config.local.json` over `.lisa.config.json`), then the
 * `lisa-secrets-access` runtime default.
 * @module tests/unit/secrets/remote-env-configured-provider
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emitContainer,
  ensureProviderCli,
  resolveEmitTarget,
  resolveSecretsProvider,
  workstationProviderFor,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

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

  it("lets the local config override the committed one", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "bitwarden" } });
    writeLayer(".lisa.config.local.json", { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({ argv: [], env: {}, cwd: root })
    ).resolves.toStrictEqual({ provider: "doppler", source: "config" });
  });

  it("lets an explicit environment override beat the config", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveSecretsProvider({
        argv: [],
        env: { LISA_PROVIDER: "1password" },
        cwd: root,
      })
    ).resolves.toStrictEqual({ provider: "1password", source: "environment" });
  });

  it("lets a flag beat the environment", async () => {
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

describe("resolveEmitTarget with a configured provider", () => {
  it("names the configured provider's bootstrap variable", async () => {
    writeLayer(COMMITTED, { secrets: { provider: "doppler" } });

    await expect(
      resolveEmitTarget(["--tenant=acme"], {}, root)
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
