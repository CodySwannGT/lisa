/**
 * CLI tests for the Telegram bot token held in the secrets provider
 * (CodySwannGT/lisa#4555, part 2), run as a real child process against the
 * stub `bws` (a fake vault file), stub `tmux` and stub `security`.
 *
 * Every test plants a sentinel token and proves it never reaches stdout,
 * stderr, the stub call log (argv is recorded with values redacted) or any
 * file in the sandbox; the fake vault, kept outside the sandbox, is the only
 * place it may live. The keychain stub must never run: the bootstrap comes
 * from a fake environment variable.
 * @module tests/unit/session-manager/cli-token-provider
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCalls, removeSandboxes } from "./support/cli-harness.js";
import {
  filesContaining,
  providerSandbox,
  readVault,
  removeVaults,
  runWithProvider,
  SECRET,
  SENTINEL,
  VAULT_PROJECT,
  type ProviderSandbox,
} from "./support/provider-sandbox.js";

afterEach(() => {
  removeSandboxes();
  removeVaults();
});

const STORED = [
  { id: "stub-1", key: SECRET, value: SENTINEL, projectId: VAULT_PROJECT },
];
const STORE_TOKEN = "store-token";
const START_NOW = ["start", "--settle-ms", "0"];
const NEW_SESSION = "new-session";

/**
 * Plant `<stateDir>/.env` holding the sentinel, as the old setup wrote it.
 * @param sandbox - Provider sandbox
 * @returns The file path
 */
function plantEnvFile(sandbox: ProviderSandbox): string {
  const file = path.join(sandbox.stateDir, ".env");
  mkdirSync(sandbox.stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, `TELEGRAM_BOT_TOKEN=${SENTINEL}\n`, { mode: 0o600 });
  return file;
}

/**
 * Assert the sentinel leaked nowhere this run could have written.
 * @param sandbox - Provider sandbox
 * @param result - The run's output
 * @param result.stdout - stdout
 * @param result.stderr - stderr
 */
function expectNoLeak(
  sandbox: ProviderSandbox,
  result: { stdout: string; stderr: string }
): void {
  expect(result.stdout).not.toContain(SENTINEL);
  expect(result.stderr).not.toContain(SENTINEL);
  expect(filesContaining(sandbox.base, SENTINEL)).toEqual([]);
  expect(readCalls(sandbox).filter(call => call.bin === "security")).toEqual(
    []
  );
}

describe("store-token with a secrets provider", () => {
  it("migrates a plaintext .env into the provider, verifies it, and deletes the file", () => {
    const sandbox = providerSandbox();
    const file = plantEnvFile(sandbox);
    const result = runWithProvider(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      stored: true,
      storage: "provider",
      provider: "bitwarden",
      secret: SECRET,
      verified: true,
      migratedFrom: file,
      deleted: true,
    });
    expect(existsSync(file)).toBe(false);
    const row = readVault(sandbox).find(entry => entry.key === SECRET);
    expect(row).toMatchObject({ value: SENTINEL, projectId: VAULT_PROJECT });
    const create = readCalls(sandbox).find(call =>
      call.argv.includes("create")
    );
    expect(create?.argv).toContain("<redacted>");
    expect(create?.envKeys).toContain("BWS_ACCESS_TOKEN");
    expectNoLeak(sandbox, result);
  });

  it("with no .env and no TTY prints the commands and writes nothing", () => {
    const sandbox = providerSandbox();
    const result = runWithProvider(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ stored: false, reason: "no-tty" });
    expect(result.json.clipboardCommand).toContain("--from-clipboard");
    expect(readVault(sandbox)).toEqual([]);
    expect(existsSync(path.join(sandbox.stateDir, ".env"))).toBe(false);
  });

  it("keeps an already-stored token and exits 0", () => {
    const sandbox = providerSandbox(STORED);
    const result = runWithProvider(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ stored: true, alreadyStored: true });
    expectNoLeak(sandbox, result);
  });

  it("fails (exit 1) with retry guidance and keeps the .env when rate-limited", () => {
    const sandbox = providerSandbox();
    const file = plantEnvFile(sandbox);
    const result = runWithProvider(sandbox, [STORE_TOKEN], {
      env: { STUB_BWS_FAIL: "rate-limit" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/rate-limited/);
    expect(existsSync(file)).toBe(true);
  });
});

describe("start with a secrets provider", () => {
  it("resolves the token once and hands it to tmux on stdin only", () => {
    const sandbox = providerSandbox(STORED);
    const result = runWithProvider(sandbox, START_NOW);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      status: "started",
      notify: "telegram",
      tokenSource: "provider",
      secret: SECRET,
    });
    const sourced = result.calls.filter(call => call.bin === "tmux");
    const launch = sourced.find(call => call.argv[0] === "start-server");
    expect(launch?.argv).toEqual(["start-server", ";", "source-file", "-"]);
    expect(launch?.envKeys).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(launch?.extra).toMatchObject({
      sourced: NEW_SESSION,
      envNames: ["TELEGRAM_STATE_DIR", "SM_SCRIPTS_DIR", "TELEGRAM_BOT_TOKEN"],
      tokenSha256: createHash("sha256").update(SENTINEL).digest("hex"),
    });
    expect(launch?.extra?.command).toContain("--channels");
    expect(sourced.some(call => call.argv[0] === NEW_SESSION)).toBe(false);
    expect(result.calls.filter(call => call.bin === "bws")).toHaveLength(1);
    expectNoLeak(sandbox, result);
  });

  it.each(["rate-limit", "unavailable"])(
    "fails (exit 1) with no tmux call when the provider is %s",
    failure => {
      const sandbox = providerSandbox(STORED);
      const result = runWithProvider(sandbox, ["start"], {
        env: { STUB_BWS_FAIL: failure },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Nothing was started");
      expect(result.stderr).toContain("Wait a minute and run start again");
      expect(result.calls.filter(call => call.bin === "tmux")).toEqual([]);
      expectNoLeak(sandbox, result);
    }
  );

  it("refuses (exit 2) a leftover plaintext .env with the exact store-token command", () => {
    const sandbox = providerSandbox(STORED);
    plantEnvFile(sandbox);
    const result = runWithProvider(sandbox, ["start"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /node '[^']*session-manager\.mjs' store-token --project-root '[^']+'/
    );
    expect(result.calls.filter(call => call.bin === "tmux")).toEqual([]);
    expect(result.stderr).not.toContain(SENTINEL);
  });

  it("refuses (exit 2) when the provider holds no such secret", () => {
    const sandbox = providerSandbox([]);
    const result = runWithProvider(sandbox, ["start"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(SECRET);
  });

  it("refuses (exit 2) when secrets.require does not declare the secret", () => {
    const sandbox = providerSandbox(STORED, { require: ["SOMETHING_ELSE"] });
    const result = runWithProvider(sandbox, ["start"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("secrets.require");
    expect(result.calls.filter(call => call.bin === "bws")).toEqual([]);
  });

  it("never passes tmux's stderr through, since the line carries the token", () => {
    const sandbox = providerSandbox(STORED);
    const result = runWithProvider(sandbox, ["start"], {
      env: { STUB_TMUX_SOURCE_FAILS: "1" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tmux");
    expectNoLeak(sandbox, result);
  });

  it("prints a foreground line that resolves the token instead of holding it", () => {
    const sandbox = providerSandbox(STORED);
    const result = runWithProvider(sandbox, START_NOW, {
      env: { STUB_TMUX_SESSION_DIES: "1" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      new RegExp(
        `TELEGRAM_BOT_TOKEN="\\$\\(node '[^']*resolve-secret\\.mjs' get ${SECRET}\\)"`
      )
    );
    expectNoLeak(sandbox, result);
  });

  it("keeps the file path when no provider is configured (tokenSource file)", () => {
    const sandbox = providerSandbox(STORED, { provider: "env" });
    plantEnvFile(sandbox);
    const result = runWithProvider(sandbox, START_NOW);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ tokenSource: "file" });
    expect(result.calls.some(call => call.argv[0] === NEW_SESSION)).toBe(true);
    expect(readFileSync(sandbox.log, "utf8")).not.toContain(SENTINEL);
  });
});
