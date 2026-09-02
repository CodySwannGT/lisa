/**
 * `~/.aws/credentials` must end up 0600 even when the file already existed.
 *
 * `fs.writeFileSync(path, data, { mode })` applies `mode` only when it CREATES
 * the file. A container that ships its own `~/.aws/credentials` — or any run
 * after the first — would therefore keep whatever permissions were already
 * there, while the file now holds the bootstrap key pair. Writing through the
 * atomic helper chmods before the rename, so the result is 0600 either way.
 * @module tests/unit/secrets/aws-profiles-permissions
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** The project these profiles belong to. */
const OWNER = "acmeco";

/** Scratch homes to remove. */
const homes: string[] = [];

/** Where the credentials land, relative to home. */
const CREDENTIALS = ".aws/credentials";

/** A bundle rendering one usable profile. */
const BUNDLE = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  profiles: {
    "agent-dev": {
      roleArn: "arn:aws:iam::1:role/RemoteAgent",
      region: "us-east-1",
    },
  },
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A scratch home.
 * @returns Its path.
 */
function scratchHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-awsperm-"));
  homes.push(home);
  return home;
}

describe("~/.aws permissions", () => {
  it("writes 0600 when creating the file", () => {
    const home = scratchHome();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    expect(statSync(path.join(home, CREDENTIALS)).mode & 0o777).toBe(0o600);
  });

  it("tightens a pre-existing world-readable file to 0600", () => {
    // The case `mode` silently misses: the file already exists, so writeFileSync
    // would leave 0644 on a file that now contains a key pair.
    const home = scratchHome();
    mkdirSync(path.join(home, ".aws"), { recursive: true });
    const file = path.join(home, CREDENTIALS);
    writeFileSync(file, "[theirs]\n");
    chmodSync(file, 0o644);

    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("still preserves the foreign content it tightened", () => {
    // Tightening must not become an excuse to replace the file.
    const home = scratchHome();
    mkdirSync(path.join(home, ".aws"), { recursive: true });
    const file = path.join(home, CREDENTIALS);
    writeFileSync(file, "[theirs]\naws_access_key_id = THEIRS\n");
    chmodSync(file, 0o644);

    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
