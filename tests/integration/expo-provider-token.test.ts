import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(
  "plugins/src/base/skills/lisa-secrets-access/scripts/resolve-expo-token.mjs"
);
const ENV_FILE = "github-env";
const CONFIG_FILE = ".lisa.config.json";
let root: string;

/**
 * Run the actual resolver with only synthetic credentials and an owned home.
 * @param extra - Synthetic environment overrides.
 * @returns The captured subprocess result.
 */
function run(extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      HOME: root,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      GITHUB_ENV: join(root, ENV_FILE),
      LISA_SECRETS_BOOTSTRAP: "fixture-bootstrap",
      ...extra,
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lisa-expo-provider-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({
      secrets: {
        provider: "bitwarden",
        namespace: "fixture",
        bootstrap: { key: "BWS_ACCESS_TOKEN_fixture", sources: ["env"] },
        require: ["EXPO_TOKEN"],
      },
    })
  );
  writeFileSync(join(root, ENV_FILE), "");
  writeFileSync(
    join(root, "bin/bws"),
    `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('bws 2.1.0'); process.exit(0); }
if (process.env.BWS_ACCESS_TOKEN !== 'fixture-bootstrap' || process.env.LISA_SECRETS_BOOTSTRAP || process.env.BWS_ACCESS_TOKEN_fixture) process.exit(9);
if (process.env.FIXTURE_FAIL) { console.error('provider-secret-must-not-leak'); process.exit(1); }
console.log(JSON.stringify([{key:'EXPO_TOKEN',value:'fixture-expo-token'}, {key:'UNRELATED_TOKEN',value:'unrelated-secret'}]));
`,
    { mode: 0o755 }
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Expo token resolution in an Actions job", () => {
  it("resolves the configured provider and exports only a masked Expo token", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("::add-mask::fixture-expo-token\n");
    const exported = readFileSync(join(root, ENV_FILE), "utf8");
    expect(exported).toMatch(
      /^EXPO_TOKEN<<[^\n]+\nfixture-expo-token\n[^\n]+\n$/
    );
    expect(exported).not.toContain("unrelated-secret");
    expect(result.stderr).toBe("");
  });

  it("prefers an explicit token without reading provider configuration", () => {
    writeFileSync(join(root, CONFIG_FILE), "invalid JSON");
    const result = run({ EXPO_TOKEN: "explicit-token" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("::add-mask::explicit-token\n");
    expect(readFileSync(join(root, ENV_FILE), "utf8")).toContain(
      "explicit-token"
    );
  });

  it("leaves an unconfigured project without a token unchanged", () => {
    writeFileSync(join(root, CONFIG_FILE), "{}");
    const result = run({ LISA_SECRETS_BOOTSTRAP: "" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(readFileSync(join(root, ENV_FILE), "utf8")).toBe("");
  });

  it("fails without publishing credentials when the provider read fails", () => {
    const result = run({ FIXTURE_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to resolve EXPO_TOKEN");
    expect(result.stdout + result.stderr).not.toContain(
      "provider-secret-must-not-leak"
    );
    expect(readFileSync(join(root, ENV_FILE), "utf8")).toBe("");
  });

  it("keeps the declared secret allowlist enforced", () => {
    const config = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8"));
    config.secrets.require = ["OTHER_TOKEN"];
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config));
    const result = run();
    expect(result.status).toBe(1);
    expect(readFileSync(join(root, ENV_FILE), "utf8")).toBe("");
  });

  it("escapes mask commands and safely exports multiline values", () => {
    const result = run({ EXPO_TOKEN: "line%one\n::error::two\r" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("::add-mask::line%25one%0A::error::two%0D\n");
    expect(readFileSync(join(root, ENV_FILE), "utf8")).toContain(
      "line%one\n::error::two\r\n"
    );
  });
});
