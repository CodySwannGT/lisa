/**
 * @file create-secret.test.ts
 * @description `createSecret`, and the value-safe error path it shares with
 * `writeSecret` (CodySwannGT/lisa#4555).
 *
 * `bws secret create` (2.1.0) takes the value as a positional argument and
 * its help lists no stdin or file option, so the value is in argv — the same
 * documented exception as `bws secret edit`. Node's `execFileSync` then puts
 * that whole command line in its error message, so an unsanitized failure
 * would print the secret it was writing. These tests run against the
 * session-manager stub `bws` over a fake vault file: never a real vault.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSecret,
  writeSecret,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";
import { stubOnlyPath } from "../session-manager/support/provider-sandbox.js";

/** A fake value, assembled so it is not a literal. */
const VALUE = ["555000111", "SENTINEL-create-abcdefghijklmnopqrstuvwxyz"].join(
  ":"
);
const CFG = {
  provider: "bitwarden",
  bootstrap: { sources: ["env"], key: "BWS_ACCESS_TOKEN_DEMO" },
};

let dir = "";
let vault = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sm-create-"));
  vault = path.join(dir, "vault.json");
  writeFileSync(vault, "[]");
  vi.stubEnv("PATH", stubOnlyPath());
  vi.stubEnv("BWS_ACCESS_TOKEN_DEMO", "fake-bootstrap-for-tests");
  vi.stubEnv("STUB_BWS_VAULT", vault);
  vi.stubEnv("STUB_LOG", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The message `fn` throws.
 * @param fn - Call expected to throw
 * @returns The message
 */
function thrown(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a throw");
}

describe("createSecret", () => {
  it("creates the record in the named project", () => {
    createSecret(CFG, {
      name: "TELEGRAM_BOT_TOKEN_DEMO",
      value: VALUE,
      projectId: "proj-1",
      note: "Telegram bot token.",
    });
    expect(JSON.parse(readFileSync(vault, "utf8"))).toEqual([
      expect.objectContaining({
        key: "TELEGRAM_BOT_TOKEN_DEMO",
        value: VALUE,
        projectId: "proj-1",
        note: "Telegram bot token.",
      }),
    ]);
  });

  it.each([
    ["rate-limit", /429 Too Many Requests/],
    ["unavailable", /refused the request or could not be reached/],
  ])("never puts the value in the error when bws fails (%s)", (fail, why) => {
    vi.stubEnv("STUB_BWS_FAIL", fail);
    const message = thrown(() =>
      createSecret(CFG, { name: "X_TOKEN", value: VALUE, projectId: "p" })
    );
    expect(message).toMatch(why);
    expect(message).toContain("creating a secret in Bitwarden");
    expect(message).not.toContain(VALUE);
  });

  it("refuses a name that is not an environment variable name", () => {
    expect(() =>
      createSecret(CFG, { name: "bad name", value: VALUE, projectId: "p" })
    ).toThrow(/environment variable name/);
  });

  it("names where to add support for a provider without one", () => {
    expect(() =>
      createSecret(
        { ...CFG, provider: "doppler" },
        { name: "X_TOKEN", value: VALUE, projectId: "p" }
      )
    ).toThrow(/has no create implemented/);
  });
});

/**
 * The error `fn` throws, whole.
 * @param fn - Call expected to throw
 * @returns The thrown value
 */
function caught(fn: () => void): Error & Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  throw new Error("expected a throw");
}

describe("a provider binary that cannot be spawned", () => {
  it.each([
    [
      "createSecret",
      () =>
        createSecret(CFG, { name: "X_TOKEN", value: VALUE, projectId: "p" }),
    ],
    ["writeSecret", () => writeSecret(CFG, "id-1", VALUE)],
  ])("%s strips the argv from the spawn error", (_label, call) => {
    // A PATH holding only an empty dir: no bws at all, stub or real.
    const empty = mkdtempSync(path.join(dir, "empty-path-"));
    vi.stubEnv("PATH", empty);
    const error = caught(call);
    expect(error.code).toBe("ENOENT");
    expect(error).not.toHaveProperty("spawnargs");
    expect(error).not.toHaveProperty("cmd");
    expect(error.message).not.toContain(VALUE);
    const everything = JSON.stringify(
      Object.getOwnPropertyNames(error).map(key => [key, error[key]])
    );
    expect(everything).not.toContain(VALUE);
  });
});

describe("writeSecret", () => {
  it("never puts the value in the error when bws fails", () => {
    vi.stubEnv("STUB_BWS_FAIL", "unavailable");
    const message = thrown(() => writeSecret(CFG, "id-1", VALUE));
    expect(message).toContain("updating a secret in Bitwarden");
    expect(message).not.toContain(VALUE);
  });
});
