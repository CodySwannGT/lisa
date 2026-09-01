/**
 * `--aws-profiles-only` writes `~/.aws` and nothing else, on any surface.
 *
 * A laptop refuses to materialize secrets to disk — read-through to the provider
 * adds no drift and leaves no copy. That rule governs the values in
 * `secrets.env` and is unchanged here.
 *
 * The AWS profiles are a separate, explicitly requested bargain: agents working
 * on a developer's machine should act as `RemoteAgent` rather than borrow the
 * human's SSO identity, giving separate CloudTrail attribution, the role's blast
 * radius instead of a person's, and the same `agent-*` names a container uses.
 *
 * The cost is that `source_profile` needs a long-lived key pair on a machine
 * that is not disposable. That is why this mode is per-run and never part of a
 * normal materialize — the tests below pin exactly that boundary.
 * @module tests/unit/secrets/local-aws-profiles
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** Scratch homes to remove. */
const homes: string[] = [];

/** The developer's SSO session block, which must survive untouched. */
const SSO_SECTION = "[sso-session acmeorgd]";

/** Where the merged config lands, relative to home. */
const CONFIG = ".aws/config";

/** A developer's own SSO config, which must survive untouched. */
const THEIRS = [
  SSO_SECTION,
  "sso_start_url = https://example.awsapps.com/start",
  "",
  "[profile acmeorgd-dev]",
  "sso_session = acmeorgd",
  "sso_account_id = 123456789012",
  "",
].join("\n");

/** The project these agent profiles belong to. */
const OWNER = "acmeco";

/** The bundle an agent-on-a-laptop run writes. */
const BUNDLE = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  externalId: "ext-1",
  profiles: {
    "agent-dev": {
      roleArn: "arn:aws:iam::123456789012:role/RemoteAgent",
      region: "us-east-1",
    },
    "agent-production": {
      roleArn: "arn:aws:iam::210987654321:role/RemoteAgent",
    },
  },
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A home holding a developer's existing SSO config.
 * @returns Its path.
 */
function homeWithSso(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-localaws-"));
  homes.push(home);
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  writeFileSync(path.join(home, CONFIG), THEIRS);
  return home;
}

describe("agent profiles alongside a developer's SSO config", () => {
  it("adds the agent profiles without disturbing the SSO ones", () => {
    // The laptop case that makes this dangerous: 20+ sections across several
    // tenants, none of which this wrote.
    const home = homeWithSso();

    expect(installAwsProfiles(BUNDLE, { home, owner: OWNER })).toEqual([
      "acmeco-agent-dev",
      "acmeco-agent-production",
    ]);

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).toContain(SSO_SECTION);
    expect(config).toContain("[profile acmeorgd-dev]");
    expect(config).toContain("sso_account_id = 123456789012");
    expect(config).toContain("[profile acmeco-agent-dev]");
  });

  it("never writes a [default] profile", () => {
    // A `default` would be picked up by any call naming no profile, silently
    // running as the assume-only identity instead of the human's SSO.
    const home = homeWithSso();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    const credentials = readFileSync(
      path.join(home, ".aws/credentials"),
      "utf8"
    );
    expect(config).not.toContain("[default]");
    expect(credentials).not.toContain("[default]");
  });

  it("does not write the materialized secrets file", () => {
    // The local no-copy-on-disk rule is unchanged: this mode writes ~/.aws only.
    const home = homeWithSso();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    expect(existsSync(path.join(home, ".config"))).toBe(false);
  });

  it("re-running replaces its block rather than accumulating", () => {
    const home = homeWithSso();
    installAwsProfiles(BUNDLE, { home, owner: OWNER });
    installAwsProfiles(BUNDLE, { home, owner: OWNER });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config.split("[profile acmeco-agent-dev]").length - 1).toBe(1);
    expect(config).toContain(SSO_SECTION);
  });
});
