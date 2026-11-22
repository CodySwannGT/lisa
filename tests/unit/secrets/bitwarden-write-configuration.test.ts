/** Bitwarden-compatible key derivation, authenticated formats, and profile routing. */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decrypt,
  deriveAccessKey,
  encrypt,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bitwarden-encryption.mjs";
import { bitwardenEndpoints } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bitwarden-endpoints.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

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
  let executablePath: string;

  /**
   * Build a provider environment with a canary that the CLI must never inherit.
   * @param profile - Profile to select explicitly, when supplied
   * @returns Environment for endpoint resolution
   */
  function options(profile?: string) {
    return {
      PATH: executablePath,
      BWS_ACCESS_TOKEN: "test-canary",
      BWS_CONFIG_FILE: config,
      BWS_PROFILE: profile,
    };
  }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "bws-profile-"));
    config = join(folder, "config");
    executablePath = join(folder, "bin");
    mkdirSync(executablePath);
    writeFileSync(
      join(executablePath, "bws"),
      [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        "const [command, key, value, profileFlag, profile, configFlag, config] = process.argv.slice(2);",
        "if (command !== 'config' || key !== 'state-opt-out' || value !== 'true') process.exit(2);",
        "if (profileFlag !== '--profile' || !profile.startsWith('lisa-read-') || configFlag !== '--config-file') process.exit(3);",
        "if (process.env.BWS_ACCESS_TOKEN || (fs.statSync(config).mode & 0o777) !== 0o600) process.exit(4);",
        "const source = new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(config));",
        "if (source === 'invalid') process.exit(5);",
        "fs.appendFileSync(config, '\\n\\n[profiles.' + profile + ']\\nstate_opt_out = \"true\"\\n');",
      ].join("\n"),
      { mode: 0o700 }
    );
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
    const original = readFileSync(config, "utf8");
    expect(bitwardenEndpoints(ACCOUNT, options("work"))).toEqual({
      api: "https://api.work.example/bw",
      identity: "https://identity.work.example/bw",
    });
    expect(bitwardenEndpoints(ACCOUNT, options())).toEqual({
      api: "https://tenant.example/secrets/api",
      identity: "https://tenant.example/secrets/identity",
    });
    expect(bitwardenEndpoints("other-account", options())).toEqual({
      api: "https://vault.bitwarden.eu/api",
      identity: "https://vault.bitwarden.eu/identity",
    });
    expect(readFileSync(config, "utf8")).toBe(original);
  });

  it("reads a named profile from a standalone plugin without installed Lisa dependencies", () => {
    const source = new URL(
      "../../../plugins/src/base/skills/",
      import.meta.url
    );
    const skill = "lisa-secrets-access/scripts";
    const boundedChild = "lisa-setup-workstation/scripts/bounded-child.mjs";
    const owner = join(folder, skill, "bitwarden-endpoints.mjs");
    cpSync(new URL(skill, source), join(folder, skill), { recursive: true });
    cpSync(new URL(boundedChild, source), join(folder, boundedChild));
    writeFileSync(
      config,
      [
        '[profiles."work.team"]',
        "state_dir = '''",
        "[profiles.ignored]",
        "'''",
        "server_base = 'https://work.example/vault/'",
      ].join("\n")
    );

    const result = boundedSpawnSync({
      label: "standalone Bitwarden profile",
      command: process.execPath,
      args: [
        "--input-type=module",
        "-e",
        [
          "import {pathToFileURL} from 'node:url';",
          "const owner = pathToFileURL(process.argv[1]);",
          "const {bitwardenEndpoints} = await import(owner);",
          "const options = {...process.env, BWS_CONFIG_FILE:process.argv[2], BWS_PROFILE:'work.team'};",
          "console.log(JSON.stringify(bitwardenEndpoints(process.argv[3], options)));",
        ].join("\n"),
        owner,
        config,
        ACCOUNT,
      ],
      cwd: folder,
      env: { PATH: executablePath },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      api: "https://work.example/vault/api",
      identity: "https://work.example/vault/identity",
    });
  });

  it("rejects invalid or missing explicit configuration before sending credentials", () => {
    expect(() => bitwardenEndpoints(ACCOUNT, options("missing"))).toThrow(
      /profile is missing/u
    );
    expect(() =>
      bitwardenEndpoints(ACCOUNT, { BWS_CONFIG_FILE: join(folder, "missing") })
    ).toThrow();
    expect(() =>
      bitwardenEndpoints(ACCOUNT, {
        BWS_SERVER_URL: "file:///tmp/not-a-server",
      })
    ).toThrow(/invalid Bitwarden endpoint/u);
  });

  it("rejects a configuration the CLI cannot validate and preserves its bytes", () => {
    writeFileSync(config, "invalid");
    expect(() => bitwardenEndpoints(ACCOUNT, options())).toThrow();
    expect(readFileSync(config, "utf8")).toBe("invalid");
  });

  it("passes original bytes to the CLI, including invalid UTF-8", () => {
    const original = Buffer.concat([
      Buffer.from("# invalid byte "),
      Buffer.from([0xff]),
      Buffer.from("\n"),
      readFileSync(config),
    ]);
    writeFileSync(config, original);
    expect(() => bitwardenEndpoints(ACCOUNT, options("work"))).toThrow();
    expect(readFileSync(config)).toEqual(original);
  });

  it("validates a profile base only for endpoints that use it", () => {
    const base = '[profiles.work]\nserver_base = "http://remote.example"\n';
    const api = 'server_api = "https://api.work.example"\n';
    writeFileSync(
      config,
      `${base}${api}server_identity = "https://id.work.example"`
    );
    expect(bitwardenEndpoints(ACCOUNT, options("work"))).toEqual({
      api: "https://api.work.example",
      identity: "https://id.work.example",
    });
    writeFileSync(config, base + api);
    expect(() => bitwardenEndpoints(ACCOUNT, options("work"))).toThrow(
      /invalid Bitwarden endpoint/u
    );
  });

  it.each(["http://remote.example", "http://localhost:8000", "http://127.1"])(
    "rejects nonliteral loopback or remote HTTP URL %s",
    server => {
      expect(() =>
        bitwardenEndpoints(ACCOUNT, { BWS_SERVER_URL: server })
      ).toThrow(/invalid Bitwarden endpoint/u);
    }
  );

  it.each(["?", "#"])(
    "rejects a bare URL delimiter %s before appending paths",
    delimiter => {
      expect(() =>
        bitwardenEndpoints(ACCOUNT, {
          BWS_SERVER_URL: `https://example.test/mount${delimiter}`,
        })
      ).toThrow(/invalid Bitwarden endpoint/u);
    }
  );

  it("preserves encoded URL path characters", () => {
    const server = "https://example.test/path%3F%23";
    expect(bitwardenEndpoints(ACCOUNT, { BWS_SERVER_URL: server })).toEqual({
      api: `${server}/api`,
      identity: `${server}/identity`,
    });
  });

  it.each(["127.0.0.1", "[::1]"])(
    "allows literal HTTP loopback URL %s",
    host => {
      const server = `http://${host}:8000`;
      expect(bitwardenEndpoints(ACCOUNT, { BWS_SERVER_URL: server })).toEqual({
        api: `${server}/api`,
        identity: `${server}/identity`,
      });
    }
  );
});
