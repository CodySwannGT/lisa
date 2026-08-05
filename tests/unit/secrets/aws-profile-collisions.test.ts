/**
 * A profile name already used outside our block must stop the write.
 *
 * AWS does not error on a duplicate `[profile x]` — it resolves one and ignores
 * the other. So writing a name an operator already uses would silently run some
 * calls as the wrong identity, which is worse than either side winning
 * outright: the file looks right and behaves wrongly.
 *
 * Merging protects the operator's sections from deletion; this protects them
 * from being shadowed. The module never renames theirs — it writes its own block
 * and nothing else, so the operator resolves the clash and re-runs.
 * @module tests/unit/secrets/aws-profile-collisions
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collidingProfiles,
  installAwsProfiles,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** The suffixed agent profile name, which cannot clash with SSO. */
const STATIC_NAME = "tunnl-dev-static";

/** Scratch homes to remove. */
const homes: string[] = [];

/** Where the config lands, relative to home. */
const CONFIG = ".aws/config";

/** An operator's own SSO profile, using a name the bundle also declares. */
const THEIRS = [
  "[sso-session tunnl]",
  "sso_start_url = https://example.awsapps.com/start",
  "",
  "[profile tunnl-dev]",
  "sso_session = tunnl",
  "",
].join("\n");

/** A bundle whose profile names clash with the operator's. */
const CLASHING = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  profiles: {
    "tunnl-dev": { roleArn: "arn:aws:iam::905179307867:role/RemoteAgent" },
  },
};

/** A bundle using the suffixed scheme, which cannot clash. */
const SUFFIXED = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  profiles: {
    [STATIC_NAME]: {
      roleArn: "arn:aws:iam::905179307867:role/RemoteAgent",
    },
  },
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A home holding the operator's config.
 * @returns Its path.
 */
function homeWithTheirs(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-collide-"));
  homes.push(home);
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  writeFileSync(path.join(home, CONFIG), THEIRS);
  return home;
}

describe("collidingProfiles", () => {
  it("reports a name defined outside the managed block", () => {
    const home = homeWithTheirs();

    expect(collidingProfiles(path.join(home, ".aws"), ["tunnl-dev"])).toEqual([
      "tunnl-dev",
    ]);
  });

  it("ignores names that only exist INSIDE our own block", () => {
    // Our previous output is meant to be replaced. Counting it would make the
    // second run of an unchanged config fail.
    const home = homeWithTheirs();
    installAwsProfiles(SUFFIXED, { home });

    expect(collidingProfiles(path.join(home, ".aws"), [STATIC_NAME])).toEqual(
      []
    );
  });

  it("does not match a different profile that merely shares a prefix", () => {
    const home = homeWithTheirs();

    expect(collidingProfiles(path.join(home, ".aws"), [STATIC_NAME])).toEqual(
      []
    );
  });

  it("returns nothing when no config exists yet", () => {
    const home = mkdtempSync(path.join(tmpdir(), "lisa-collide-"));
    homes.push(home);

    expect(collidingProfiles(path.join(home, ".aws"), ["tunnl-dev"])).toEqual(
      []
    );
  });
});

describe("installAwsProfiles refuses a colliding write", () => {
  it("throws, names the collision, and suggests a rename", () => {
    const home = homeWithTheirs();

    expect(() => installAwsProfiles(CLASHING, { home })).toThrow(
      /already defines "tunnl-dev"/
    );
  });

  it("leaves the operator's file byte-identical when it refuses", () => {
    // A guard that half-wrote would be worse than no guard.
    const home = homeWithTheirs();

    expect(() => installAwsProfiles(CLASHING, { home })).toThrow();
    expect(readFileSync(path.join(home, CONFIG), "utf8")).toBe(THEIRS);
  });

  it("writes cleanly when the suffixed scheme avoids the clash", () => {
    // The reason the `-static` naming exists: no rename, no collision, and the
    // operator's SSO profiles are never touched.
    const home = homeWithTheirs();

    expect(installAwsProfiles(SUFFIXED, { home })).toEqual([
      "tunnl-dev-static",
    ]);

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).toContain("[profile tunnl-dev]");
    expect(config).toContain("[profile tunnl-dev-static]");
  });
});
