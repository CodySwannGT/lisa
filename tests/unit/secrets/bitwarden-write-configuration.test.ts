/** Bitwarden-compatible key derivation, authenticated formats, and profile routing. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decrypt,
  deriveAccessKey,
  encrypt,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bitwarden-encryption.mjs";
import { bitwardenEndpoints } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bitwarden-endpoints.mjs";

const ACCOUNT = "b0fb3722-95ae-46ad-a6d1-209e1f7af2c4";
const testKey = Buffer.alloc(64, 0x12);

describe("Bitwarden encryption", () => {
  it("uses the documented access-token derivation for a fixed seed", () => {
    const seed = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    expect(deriveAccessKey(seed).toString("hex")).toBe(
      "bf0d5f66f038a593ddae63c54cc3933ba9eca47f04704f4a6545b3c1684efb3edea" +
        "80ef4ba4f0d5b80700d53e132ee96016434c6b77e823e60b2ddddd60ec8c7"
    );
  });

  it("uses a fresh IV and preserves leading Unicode and CRLF bytes", () => {
    const value = "\uFEFFline 1\r\nline 2 λ";
    const sealed = encrypt(testKey, value);
    expect(sealed).toMatch(/^2\./u);
    expect(sealed).not.toBe(encrypt(testKey, value));
    expect(decrypt(testKey, sealed)).toBe(value);
  });

  it("rejects a modified IV and the wrong authentication key", () => {
    const [iv, encrypted, mac] = encrypt(testKey, "example")
      .slice(2)
      .split("|");
    const bytes = Buffer.from(iv!, "base64");
    bytes[0] = bytes[0]! ^ 1;
    const altered = [`2.${bytes.toString("base64")}`, encrypted, mac].join("|");
    expect(() => decrypt(testKey, altered)).toThrow(/authentication failed/u);
    expect(() =>
      decrypt(Buffer.alloc(64), encrypt(testKey, "example"))
    ).toThrow(/authentication failed/u);
  });
});

describe("Bitwarden bws profiles", () => {
  let folder: string;
  let config: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "bws-profile-"));
    config = join(folder, "config");
    writeFileSync(
      config,
      [
        "[profiles.default]",
        'server_base = "https://vault.bitwarden.eu/"',
        "[profiles.work]",
        'server_api = "https://api.work.example/bw/"',
        'server_identity = "https://identity.work.example/bw/"',
        `[profiles."${ACCOUNT}"]`,
        'server_base = "https://tenant.example/secrets///"',
      ].join("\n")
    );
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it("prefers an explicit server and skips profile lookup", () => {
    expect(
      bitwardenEndpoints(ACCOUNT, {
        BWS_CONFIG_FILE: join(folder, "unreadable"),
        BWS_PROFILE: "missing",
        BWS_SERVER_URL: "https://vault.example/custom/",
      })
    ).toEqual({
      api: "https://vault.example/custom/api",
      identity: "https://vault.example/custom/identity",
    });
  });

  it("matches an explicit profile, then the machine account and default profiles", () => {
    expect(
      bitwardenEndpoints(ACCOUNT, {
        BWS_CONFIG_FILE: config,
        BWS_PROFILE: "work",
      })
    ).toEqual({
      api: "https://api.work.example/bw",
      identity: "https://identity.work.example/bw",
    });
    expect(bitwardenEndpoints(ACCOUNT, { BWS_CONFIG_FILE: config })).toEqual({
      api: "https://tenant.example/secrets/api",
      identity: "https://tenant.example/secrets/identity",
    });
    expect(
      bitwardenEndpoints("other-account", { BWS_CONFIG_FILE: config })
    ).toEqual({
      api: "https://vault.bitwarden.eu/api",
      identity: "https://vault.bitwarden.eu/identity",
    });
  });

  it("rejects invalid or missing explicit configuration before sending credentials", () => {
    expect(() =>
      bitwardenEndpoints(ACCOUNT, {
        BWS_CONFIG_FILE: config,
        BWS_PROFILE: "missing",
      })
    ).toThrow(/profile is missing/u);
    expect(() =>
      bitwardenEndpoints(ACCOUNT, { BWS_CONFIG_FILE: join(folder, "missing") })
    ).toThrow();
    expect(() =>
      bitwardenEndpoints(ACCOUNT, {
        BWS_SERVER_URL: "file:///tmp/not-a-server",
      })
    ).toThrow(/invalid Bitwarden endpoint/u);
  });
});
