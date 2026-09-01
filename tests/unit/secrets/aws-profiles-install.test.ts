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

/** The one environment this fixture declares. */
const DEV = "agent-dev";

/** The project these profiles belong to. */
const OWNER = "acmeco";

/** The section name that stage renders as, once owned. */
const DEV_SECTION = `${OWNER}-${DEV}`;

/** Where the written config lives, relative to home. */
const CONFIG = ".aws/config";

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
    [DEV]: {
      roleArn: "arn:aws:iam::123456789012:role/RemoteAgent",
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

    expect(installAwsProfiles(BUNDLE, { home, owner: OWNER })).toEqual([
      DEV_SECTION,
    ]);
    expect(readFileSync(path.join(home, CONFIG), "utf8")).toContain(
      `[profile ${DEV_SECTION}]`
    );
  });

  it("merges into an ~/.aws it did not write, keeping both", () => {
    // Refusing outright was the first attempt and was worse than useless: a
    // container ships `~/.aws/config` holding a bare `[default]`, so the guard
    // fired every time and wrote nothing — while AWS_PROFILE was still derived
    // from the bundle. The session got a pointer to a profile that did not
    // exist: "The config profile (agent-dev) could not be found".
    //
    // Destroying their file and refusing to write ours are both wrong.
    const home = scratchHome();
    mkdirSync(path.join(home, ".aws"), { recursive: true });
    writeFileSync(
      path.join(home, CREDENTIALS),
      "[theirs]\naws_access_key_id = THEIRS\n"
    );
    writeFileSync(path.join(home, CONFIG), "[default]\nregion = us-east-1\n");

    expect(installAwsProfiles(BUNDLE, { home, owner: OWNER })).toEqual([
      DEV_SECTION,
    ]);

    const credentials = readFileSync(path.join(home, CREDENTIALS), "utf8");
    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(credentials).toContain("aws_access_key_id = THEIRS");
    expect(config).toContain("[default]");
    expect(config).toContain(`[profile ${DEV_SECTION}]`);
  });

  it("replaces its own block instead of stacking it every session", () => {
    const home = scratchHome();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });
    installAwsProfiles(BUNDLE, { home, owner: OWNER });
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(
      // Counted by FAMILY rather than by one literal marker: the module now
      // recognises every past marker version, and pinning this to one spelling
      // made it an edit on every bump instead of an assertion about the
      // property — one block, however it is spelled.
      (config.match(/>>> managed by lisa-secrets-access[^\n]*>>>/g) ?? [])
        .length
    ).toBe(1);
  });

  it("refreshes a file it wrote previously", () => {
    // Materialization runs every session; its own output must stay updatable,
    // or a rotated credential would never reach the file.
    const home = scratchHome();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    expect(
      installAwsProfiles(
        { ...BUNDLE, accessKeyId: "AKIAROTATED" },
        { home, owner: OWNER }
      )
    ).toEqual([DEV_SECTION]);
    expect(readFileSync(path.join(home, CREDENTIALS), "utf8")).toContain(
      "AKIAROTATED"
    );
  });

  it("writes nothing when the bundle has no usable key pair", () => {
    const home = scratchHome();

    expect(
      installAwsProfiles({ profiles: BUNDLE.profiles }, { home, owner: OWNER })
    ).toEqual([]);
  });
});
