/**
 * The session-manager notifications doctor check and where the Telegram bot
 * token lives (CodySwannGT/lisa#4555, part 2).
 *
 * With a secrets provider configured (`secrets.provider` set and not `env`)
 * the token belongs in the provider, so a plaintext `<stateDir>/.env` is a
 * leftover to migrate with `store-token`. With no provider the `.env` path
 * still works but is flagged as plaintext. Doctor never reads the vault and
 * only ever stats the file, so the token cannot reach the detail. Every run
 * uses a temp HOME and an injected environment.
 * @module tests/unit/cli/doctor-session-manager-provider
 */
import {
  chmod,
  readFile as fsReadFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { telegramSecretName } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/token-store.mjs";
import { checkSessionManagerIsolation } from "../../../src/cli/doctor-session-manager.js";
import { telegramSecretNameFor } from "../../../src/cli/doctor-session-manager-token.js";

const PLANTED = "987654321:PLANTED_VALUE_abcdefghijklmnopqrstuvwxyz";
const MANAGER = "p-manager";
const SECRET = "TELEGRAM_BOT_TOKEN_P_MANAGER";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/**
 * A project with a Telegram manager and, optionally, a secrets block and a
 * plaintext token file.
 * @param secrets - The `secrets` block, or undefined for none
 * @param plantFile - Whether to plant `<stateDir>/.env` (mode 0600)
 * @returns Paths and a runner
 */
async function fixture(
  secrets: Record<string, unknown> | undefined,
  plantFile: boolean
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-smp-"));
  const home = path.join(root, "home");
  const project = path.join(root, "proj");
  const stateDir = path.join(root, "state");
  const tokenFile = path.join(stateDir, ".env");
  const readFile = vi.fn((file: string) => fsReadFile(file, "utf8"));
  const run = (env: NodeJS.ProcessEnv = {}) =>
    checkSessionManagerIsolation(project, {
      home,
      env,
      readFile,
      managedSettingsPaths: [path.join(root, "managed.json")],
    });
  roots.push(root);
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  if (plantFile) {
    await writeFile(tokenFile, `TELEGRAM_BOT_TOKEN=${PLANTED}\n`);
    await chmod(tokenFile, 0o600);
  }
  await writeFile(
    path.join(project, ".lisa.config.json"),
    JSON.stringify({
      tracker: "jira",
      ...(secrets ? { secrets } : {}),
      sessionManager: {
        name: MANAGER,
        notify: { provider: "telegram", stateDir },
      },
    })
  );
  return { tokenFile, run, readFile };
}

describe("doctor: the bot token and the secrets provider", () => {
  it("is ok with the token in the provider and no plaintext file", async () => {
    const fx = await fixture({ provider: "bitwarden" }, false);
    const check = await fx.run();

    expect(check.status).toBe("ok");
    expect(check.detail).toContain(`bitwarden as ${SECRET}`);
    expect(check.detail).toMatch(/never reads the vault/);
  });

  it("warns about a leftover plaintext file in provider mode and names store-token", async () => {
    const fx = await fixture({ provider: "bitwarden" }, true);
    const check = await fx.run();

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(fx.tokenFile);
    expect(check.detail).toMatch(/plaintext/);
    expect(check.detail).toContain("store-token");
    expect(check.detail).not.toContain(PLANTED);
  });

  it.each([undefined, { provider: "env" }])(
    "warns that the token is plaintext when no provider is configured (%j)",
    async secrets => {
      const fx = await fixture(secrets, true);
      const check = await fx.run();

      expect(check.status).toBe("warn");
      expect(check.detail).toMatch(/plaintext/);
      expect(check.detail).toMatch(/no secrets provider is configured/);
      expect(check.detail).not.toContain(PLANTED);
    }
  );

  it("never reads the token file's contents", async () => {
    const fx = await fixture({ provider: "bitwarden" }, true);
    await fx.run();

    expect(fx.readFile).not.toHaveBeenCalledWith(fx.tokenFile);
  });

  it("warns, by name only, about any TELEGRAM_BOT_TOKEN* exported in its shell", async () => {
    const fx = await fixture({ provider: "bitwarden" }, false);
    const check = await fx.run({ [SECRET]: PLANTED, UNRELATED: PLANTED });

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(`${SECRET} is set`);
    expect(check.detail).not.toContain("UNRELATED");
    expect(check.detail).not.toContain(PLANTED);
  });
});

describe("telegramSecretNameFor", () => {
  it.each(["p-manager", "lisa-1a2b3c-manager", "demo_manager", "a--b"])(
    "agrees with the session-manager CLI for %s",
    name => {
      expect(telegramSecretNameFor(name)).toBe(telegramSecretName(name));
    }
  );
});
