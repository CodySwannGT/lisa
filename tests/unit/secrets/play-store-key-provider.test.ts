/**
 * The Play Store key resolves through `lisa-secrets-access`, not the keychain.
 *
 * `play-store-access` used to fall back to `security find-generic-password`
 * when no environment variable or local key path was set. A project keeping
 * the key in Doppler, AWS, 1Password or Bitwarden therefore could not resolve
 * it at all, and the direct keychain read bypassed the one chokepoint every
 * credential is meant to pass through. The fallback rung is now the standard
 * trusted resolver ladder, which asks the configured provider by exact name.
 *
 * Runs the function lifted verbatim from the skill's Markdown, so what is
 * tested is exactly what ships.
 * @module tests/unit/secrets/play-store-key-provider
 */

import { execFileSync } from "node:child_process";
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

import {
  extractFunction,
  FLOOR_RUNG,
  ladderOf,
  REQUIRED_RUNGS,
} from "../strategies/credential-resolver-ladder-helpers.js";

/** The canonical skill source; built copies are held to it by check:plugins. */
const SKILL = path.resolve(
  "plugins/src/expo/skills/play-store-access/SKILL.md"
);

/** Function that owns the key lookup. */
const FN = "read_service_account_json";

/** Value the planted resolver answers with — a stand-in, not key material. */
const RESOLVED = '{"client_email":"planted@example.invalid"}';

/** Scratch tree standing in for a consumer project. */
let project: string;

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-play-key-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

/**
 * Plant an executable stub on a private PATH directory.
 * @param bin - Directory on the private PATH.
 * @param name - Command name.
 * @param body - Shell body.
 */
const plantStub = (bin: string, name: string, body: string): void => {
  const file = path.join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};

/**
 * Plant the stubs and the trusted resolver the lookup should reach.
 *
 * A `security` that answers would hide a keychain rung behind a success, so
 * it answers AND records: any line in its log is a direct keychain read.
 * @returns The private PATH directory and the keychain call log.
 */
const plantTree = (): { bin: string; keychainLog: string } => {
  const bin = path.join(project, "bin");
  const keychainLog = path.join(project, "keychain.log");
  const resolver = path.join(project, FLOOR_RUNG);
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.dirname(resolver), { recursive: true });
  writeFileSync(keychainLog, "");
  plantStub(bin, "security", `echo "$@" >> "${keychainLog}"; echo keychain`);
  plantStub(bin, "uname", "echo Darwin");
  writeFileSync(
    resolver,
    `if (process.argv[2] === "get" && process.argv[3] === "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") process.stdout.write(${JSON.stringify(RESOLVED)});`
  );
  return { bin, keychainLog };
};

/**
 * Run the shipped function in the scratch project.
 * @param fnText - The extracted function.
 * @returns Stdout of the function and the calls the keychain stub recorded.
 */
const runKeyLookup = (fnText: string): { out: string; keychain: string } => {
  const { bin, keychainLog } = plantTree();
  const out = execFileSync(
    "/bin/bash",
    ["-c", `PACKAGE_NAME=com.example.app; KEY_PATH=; ${fnText}\n${FN}`],
    {
      cwd: project,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: project,
      },
    }
  );
  return { out, keychain: readFileSync(keychainLog, "utf8") };
};

describe("play-store-access key lookup", () => {
  const fnText = extractFunction(readFileSync(SKILL, "utf8"), FN);

  it("offers the standard trusted resolver ladder", () => {
    expect(ladderOf(fnText)).toStrictEqual([...REQUIRED_RUNGS]);
  });

  it("never reads the OS keychain directly", () => {
    expect(fnText).not.toMatch(/find-generic-password/u);
  });

  it("resolves the key through the configured provider and skips the keychain", () => {
    const { out, keychain } = runKeyLookup(fnText);

    expect(out).toBe(RESOLVED);
    expect(keychain).toBe("");
  });
});
