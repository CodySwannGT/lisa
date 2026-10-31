/**
 * Contract tests for storing the Telegram bot token in the configured
 * secrets provider (CodySwannGT/lisa#4555, part 2), against an in-memory
 * fake adapter: no real vault, CLI or network is ever used.
 *
 * Pinned here: the per-project secret name; migrating a plaintext
 * `<stateDir>/.env` (create, read back, compare, and only then delete the
 * file); refusing to delete a file holding other keys; keeping a file whose
 * token differs from the stored one; `--replace`; choosing the vault project;
 * refusing a name `secrets.require` does not declare; a provider that cannot
 * create secrets; and that the token never appears in a result or an error.
 * @module tests/unit/session-manager/token-store
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  storeTokenInProvider,
  telegramSecretName,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/token-store.mjs";
import { fakeSecrets, type FakeOptions } from "./support/fake-secrets.js";

/** A well-formed but fake bot token, assembled so it is not a literal. */
const TOKEN = ["123456789", "SENTINEL-abcdefghijklmnopqrstuvwxyz_0123"].join(
  ":"
);
const OTHER = ["987654321", "OTHERTOKEN-abcdefghijklmnopqrstuvwxyz_99"].join(
  ":"
);
const NAME = "TELEGRAM_BOT_TOKEN_DEMO_MANAGER";
const PROJECT = "proj-1";

let stateDir = "";
let base = "";

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "sm-tokstore-"));
  stateDir = path.join(base, "telegram-demo");
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const envFile = () => path.join(stateDir, ".env");

/**
 * Plant a plaintext token file.
 * @param body - File contents
 */
function plant(body = `TELEGRAM_BOT_TOKEN=${TOKEN}\n`): void {
  writeFileSync(envFile(), body, { mode: 0o600 });
}

/**
 * Run the store flow with a fake adapter.
 * @param options - Fake vault options
 * @param input - Extra store input
 * @returns The fake and the outcome (result or thrown error)
 */
async function store(
  options: FakeOptions = {},
  input: Record<string, unknown> = {}
) {
  const fake = fakeSecrets({ projectIds: [PROJECT], ...options });
  const readToken = vi.fn(async () => ({ token: TOKEN, clear: () => true }));
  try {
    const result = await storeTokenInProvider({
      cfg: fake.cfg,
      adapter: fake.adapter,
      name: NAME,
      stateDir,
      readToken,
      ...input,
    });
    return { fake, readToken, result, error: undefined };
  } catch (error) {
    return {
      fake,
      readToken,
      result: undefined,
      error: error as Error & { exitCode?: number },
    };
  }
}

describe("telegramSecretName", () => {
  it("upper-snakes the manager name under the TELEGRAM_BOT_TOKEN_ prefix", () => {
    expect(telegramSecretName("lisa-1a2b3c-manager")).toBe(
      "TELEGRAM_BOT_TOKEN_LISA_1A2B3C_MANAGER"
    );
    expect(telegramSecretName("demo_manager")).toBe(NAME);
  });
});

describe("storeTokenInProvider: migrating a plaintext .env", () => {
  it("creates the secret, verifies the read-back, then deletes the file", async () => {
    plant();
    const { fake, result, readToken } = await store();
    expect(result).toEqual({
      stored: true,
      storage: "provider",
      provider: "bitwarden",
      secret: NAME,
      verified: true,
      migratedFrom: envFile(),
      deleted: true,
    });
    expect(fake.vault.find(row => row.key === NAME)?.value).toBe(TOKEN);
    expect(fake.calls).toContain(`create ${NAME} in ${PROJECT}`);
    expect(existsSync(envFile())).toBe(false);
    expect(readToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("keeps the file and fails (exit 1) when the read-back does not match", async () => {
    plant();
    const { error } = await store({ readBackValue: OTHER });
    expect(error?.exitCode).toBe(1);
    expect(error?.message).toMatch(/kept/);
    expect(error?.message).not.toContain(TOKEN);
    expect(existsSync(envFile())).toBe(true);
  });

  it("refuses (exit 2) a file holding other keys, before writing anything", async () => {
    plant(`TELEGRAM_BOT_TOKEN=${TOKEN}\nOTHER_SETTING=1\n`);
    const { error, fake } = await store();
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("OTHER_SETTING");
    expect(fake.calls.some(call => call.startsWith("create"))).toBe(false);
    expect(existsSync(envFile())).toBe(true);
  });

  it("deletes the file without a write when the provider already holds the same token", async () => {
    plant();
    const rows = [{ key: NAME, id: "id-9", value: TOKEN, projectId: PROJECT }];
    const { result, fake } = await store({ rows });
    expect(result).toMatchObject({
      stored: true,
      alreadyStored: true,
      verified: true,
      deleted: true,
    });
    expect(fake.calls.filter(call => /create|replace/.test(call))).toEqual([]);
    expect(existsSync(envFile())).toBe(false);
  });

  it("keeps a file whose token differs from the stored one (exit 2)", async () => {
    plant();
    const rows = [{ key: NAME, id: "id-9", value: OTHER, projectId: PROJECT }];
    const { error } = await store({ rows });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("--replace");
    expect(error?.message).not.toContain(TOKEN);
    expect(error?.message).not.toContain(OTHER);
    expect(existsSync(envFile())).toBe(true);
  });

  it("with --replace overwrites a different stored token from the file", async () => {
    plant();
    const rows = [{ key: NAME, id: "id-9", value: OTHER, projectId: PROJECT }];
    const { result, fake } = await store({ rows }, { replace: true });
    expect(fake.calls).toContain("replace id-9");
    expect(fake.vault[0]?.value).toBe(TOKEN);
    expect(result).toMatchObject({ stored: true, deleted: true });
    expect(existsSync(envFile())).toBe(false);
  });

  it("refuses (exit 2) a file whose token is not bot-token shaped", async () => {
    plant("TELEGRAM_BOT_TOKEN=not-a-token\n");
    const { error, fake } = await store();
    expect(error?.exitCode).toBe(2);
    expect(error?.message).not.toContain("not-a-token");
    expect(fake.calls.some(call => call.startsWith("create"))).toBe(false);
  });
});

describe("storeTokenInProvider: no plaintext file", () => {
  it("takes the token from the prompt/clipboard reader and writes no file", async () => {
    const { result, readToken } = await store();
    expect(readToken).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stored: true, verified: true });
    expect(result).not.toHaveProperty("migratedFrom");
    expect(existsSync(envFile())).toBe(false);
  });

  it("passes a not-stored outcome (no TTY) through without writing", async () => {
    const fake = fakeSecrets({ projectIds: [PROJECT] });
    const outcome = { stored: false, reason: "no-tty", message: "m" };
    const result = await storeTokenInProvider({
      cfg: fake.cfg,
      adapter: fake.adapter,
      name: NAME,
      stateDir,
      readToken: async () => outcome,
    });
    expect(result).toEqual(outcome);
    expect(fake.calls.some(call => call.startsWith("create"))).toBe(false);
  });

  it("keeps an existing secret without prompting unless --replace", async () => {
    const rows = [{ key: NAME, id: "id-9", value: TOKEN, projectId: PROJECT }];
    const kept = await store({ rows });
    expect(kept.result).toMatchObject({ stored: true, alreadyStored: true });
    expect(kept.readToken).not.toHaveBeenCalled();
    const replaced = await store({ rows }, { replace: true });
    expect(replaced.readToken).toHaveBeenCalledTimes(1);
    expect(replaced.fake.calls).toContain("replace id-9");
  });

  it("refuses (exit 2) when secrets.require does not declare the name", async () => {
    const { error, fake } = await store({ require: ["SOMETHING_ELSE"] });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain(NAME);
    expect(error?.message).toContain("secrets.require");
    expect(fake.calls).toEqual([]);
  });

  it("fails (exit 1) with retry guidance when the provider is rate-limited", async () => {
    const { error } = await store({ listFails: "rate-limit" });
    expect(error?.exitCode).toBe(1);
    expect(error?.message).toMatch(/rate-limited/);
    expect(error?.message).toMatch(/Wait a minute/);
  });

  it("tells the operator to create the secret when the provider cannot create one", async () => {
    plant();
    const { error } = await store(
      { provider: "doppler", createFails: "no-create" },
      {}
    );
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain(NAME);
    expect(error?.message).toMatch(/create/i);
    expect(existsSync(envFile())).toBe(true);
  });
});

describe("storeTokenInProvider: vault project", () => {
  it("uses --vault-project when given", async () => {
    const { fake } = await store(
      { projectIds: [] },
      { vaultProject: "proj-x" }
    );
    expect(fake.calls).toContain(`create ${NAME} in proj-x`);
  });

  it("falls back to the one project the visible secrets live in", async () => {
    const rows = [{ key: "A", id: "a", value: "v", projectId: "proj-2" }];
    const { fake } = await store({ projectIds: [], rows });
    expect(fake.calls).toContain(`create ${NAME} in proj-2`);
  });

  it("refuses (exit 2) to guess between several projects", async () => {
    const rows = [
      { key: "A", id: "a", value: "v", projectId: "proj-2" },
      { key: "B", id: "b", value: "v", projectId: "proj-3" },
    ];
    const { error } = await store({ projectIds: [], rows });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("--vault-project");
  });

  it("refuses (exit 2) a --vault-project that secrets.narrow would hide", async () => {
    const { error } = await store({}, { vaultProject: "proj-elsewhere" });
    expect(error?.exitCode).toBe(2);
    expect(error?.message).toContain("secrets.narrow.projectIds");
  });
});
