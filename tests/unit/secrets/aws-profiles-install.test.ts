/**
 * Writing `~/.aws` must never destroy credentials this did not write.
 *
 * These are whole-file writes, so a pre-existing `credentials` file — a
 * developer's own profiles, or another tool's setup — would be replaced rather
 * than merged. This only runs on a surface allowed to write secrets to disk,
 * which is normally a disposable container, but "normally disposable" is not a
 * reason to be able to delete someone's credentials.
 * @module tests/unit/secrets/aws-profiles-install
 */

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** Where the written credentials live, relative to home. */
const CREDENTIALS = ".aws/credentials";

/** Scratch homes to remove. */
const homes: string[] = [];

/** A bundle that renders one usable profile. */
const BUNDLE = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  externalId: "ext-1",
  profiles: {
    "agent-dev": {
      roleArn: "arn:aws:iam::905179307867:role/RemoteAgent",
      region: "us-east-1",
    },
  },
};

/**
 * A scratch home directory.
 * @returns Its path.
 */
function scratchHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-awsinstall-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

describe("installAwsProfiles", () => {
  it("writes the profiles and reports their names", () => {
    const home = scratchHome();

    expect(installAwsProfiles(BUNDLE, { home })).toEqual(["agent-dev"]);
    expect(readFileSync(path.join(home, ".aws/config"), "utf8")).toContain(
      "[profile agent-dev]"
    );
  });

  it("refuses to overwrite an ~/.aws it did not write", () => {
    // The failure this prevents is silent and unrecoverable: someone's own
    // credentials replaced by ours, with no copy kept.
    const home = scratchHome();
    const existing = "[default]\naws_access_key_id = THEIRS\n";
    mkdirSync(path.join(home, ".aws"), { recursive: true });
    writeFileSync(path.join(home, CREDENTIALS), existing);

    expect(installAwsProfiles(BUNDLE, { home })).toEqual([]);
    expect(readFileSync(path.join(home, CREDENTIALS), "utf8")).toBe(existing);
  });

  it("refreshes a file it wrote previously", () => {
    // Materialization runs every session; its own output must stay updatable,
    // or a rotated credential would never reach the file.
    const home = scratchHome();
    installAwsProfiles(BUNDLE, { home });

    expect(
      installAwsProfiles({ ...BUNDLE, accessKeyId: "AKIAROTATED" }, { home })
    ).toEqual(["agent-dev"]);
    expect(readFileSync(path.join(home, CREDENTIALS), "utf8")).toContain(
      "AKIAROTATED"
    );
  });

  it("writes nothing when the bundle has no usable key pair", () => {
    const home = scratchHome();

    expect(installAwsProfiles({ profiles: BUNDLE.profiles }, { home })).toEqual(
      []
    );
  });
});
