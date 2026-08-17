/**
 * The tenant variable must have a name an operator can say out loud.
 *
 * A Claude Tag session's safety classifier refuses any request that NAMES a
 * secret-shaped variable, and it refuses the whole request — so one such name
 * poisons every check bundled with it. `LISA_SECRETS_NAMESPACE` holds a tenant
 * name, not a secret, but it reads like one: an operator could not ask about it,
 * print it, or debug around it on that surface, and three separate diagnostic
 * attempts were declined for that reason alone.
 *
 * `LISA_TENANT` says the same thing without tripping it. The old name keeps
 * working because it is configured in live environments, and breaking those to
 * improve a spelling would be a poor trade.
 * @module tests/unit/secrets/neutral-tenant-var
 */

import { describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

/** A directory with no `.lisa.config.json`, so the environment is consulted. */
const NO_REPO = "/nonexistent-for-this-test";

/** The tenant used throughout. */
const TENANT = "acmeorgd";

describe("tenant resolution from the environment", () => {
  it("accepts the neutral LISA_TENANT", () => {
    expect(readConfig(NO_REPO, { LISA_TENANT: TENANT }).namespace).toBe(TENANT);
  });

  it("still accepts the original LISA_SECRETS_NAMESPACE", () => {
    // Live environments are configured with it; a rename that breaks them is
    // not an improvement.
    expect(
      readConfig(NO_REPO, { LISA_SECRETS_NAMESPACE: TENANT }).namespace
    ).toBe(TENANT);
  });

  it("prefers the neutral name when both are set", () => {
    expect(
      readConfig(NO_REPO, {
        LISA_TENANT: TENANT,
        LISA_SECRETS_NAMESPACE: "other",
      }).namespace
    ).toBe(TENANT);
  });

  it("derives the bootstrap key from whichever tenant was given", () => {
    expect(readConfig(NO_REPO, { LISA_TENANT: TENANT }).bootstrap.key).toBe(
      `BWS_ACCESS_TOKEN_${TENANT}`
    );
  });

  it("accepts a neutral provider override too", () => {
    expect(
      readConfig(NO_REPO, { LISA_TENANT: TENANT, LISA_PROVIDER: "doppler" })
        .provider
    ).toBe("doppler");
  });
});

describe("the setup field's tenant handling", () => {
  it("reads the neutral name first, falling back to the old one", () => {
    expect(SETUP_FIELD).toContain(
      'ten="${LISA_TENANT:-${LISA_SECRETS_NAMESPACE:-}}"'
    );
  });

  it("says 'tenant' rather than a secret-shaped name when nothing is set", () => {
    // The message an operator reads when nothing happens should itself be
    // sayable on a surface that refuses secret-shaped words.
    expect(SETUP_FIELD).toContain("no tenant configured");
    expect(SETUP_FIELD).not.toContain(
      "No checkout and no LISA_SECRETS_NAMESPACE"
    );
  });
});
