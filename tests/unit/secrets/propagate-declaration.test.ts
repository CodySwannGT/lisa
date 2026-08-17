/**
 * Contract tests for what may be propagated, where, and how it is discovered.
 *
 * Sibling of `propagate-secret.test.ts`, which covers the program's own
 * guarantees. This file covers the declarations around it: the target a
 * credential may be sent to, the exposure it is granted on arrival, the config
 * shape that authorises any of it, and the one safe way to find out what a vault
 * holds.
 * @module tests/unit/secrets/propagate-declaration
 */
import { describe, expect, it } from "vitest";

import { describeEnv } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/inspect-vault.mjs";
import {
  assertDestName,
  parseArgs,
  parseTarget,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/sync-secret-to-ci.mjs";
import { validateSecrets } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

/** The credential every case here stands in for. */
const NAME = "LINEAR_API_KEY";

/**
 * The value used wherever a test needs a credential-shaped string.
 *
 * Deliberately shaped like no vendor's key. A fixture carrying a real
 * provider's prefix costs a secret-scanning alert every time the file is
 * read, and the habit that teaches — waving those alerts through — is the
 * one a secrets contract least wants to build.
 */
const VALUE = "placeholder-value-for-tests";

/** A destination organization, and a destination repository within it. */
const ORG = "AcmeOrgD";
const REPO = `${ORG}/wiki`;

/** The flag that widens or narrows an organization secret's reach. */
const VISIBILITY = "--visibility";

describe("parsing the destination", () => {
  it("reads an organization and a repository differently", () => {
    expect(parseTarget(ORG)).toMatchObject({
      kind: "org",
      listPath: `orgs/${ORG}/actions/secrets`,
    });
    expect(parseTarget(REPO)).toMatchObject({
      kind: "repo",
      listPath: `repos/${REPO}/actions/secrets`,
    });
  });

  it.each([
    ["a URL", "https://github.com/AcmeOrgD"],
    ["a three-segment path", "AcmeOrgD/wiki/main"],
    ["a traversal", "../../etc"],
    ["a query string", "AcmeOrgD?per_page=1"],
    ["empty", ""],
    ["whitespace", "   "],
    ["undefined", undefined],
  ])("refuses %s", (_label, target) => {
    // The target is interpolated into an API path. A silently mis-parsed one
    // would push a credential somewhere nobody named.
    expect(() => parseTarget(target)).toThrow(/neither an organization/);
  });

  it("refuses a destination name a workflow could not read", () => {
    expect(() => assertDestName("linear-api-key")).toThrow(
      /valid environment-variable name/
    );
    expect(assertDestName(NAME)).toBe(NAME);
  });
});

describe("exposure flags", () => {
  it("refuses a visibility the API does not accept", () => {
    expect(() => parseArgs([VISIBILITY, "public"])).toThrow(/must be one of/);
  });

  it("refuses selected visibility with no repository list", () => {
    // `selected` with no repos yields an org secret no repository can read —
    // present in the listing, therefore verifying green, and consumed by nobody.
    expect(() => parseArgs([VISIBILITY, "selected"])).toThrow(/needs --repos/);
  });

  it("keeps positionals in order alongside flags", () => {
    const { positional, options } = parseArgs([NAME, VISIBILITY, "all", ORG]);
    expect(positional).toEqual([NAME, ORG]);
    expect(options).toEqual({ visibility: "all" });
  });
});

describe("secrets.propagating", () => {
  it("accepts both declaration shapes", () => {
    // A bare string pins the credential; an object pins where it may go too.
    // Both must validate, or the stronger declaration is unusable and everyone
    // falls back to the looser one.
    expect(
      validateSecrets({
        provider: "env",
        propagating: [NAME, { name: "NPM_TOKEN", targets: [ORG, REPO] }],
      })
    ).toEqual([]);
  });

  it("rejects an entry with no exact name", () => {
    const problems = validateSecrets({
      provider: "env",
      propagating: [{ targets: [ORG] }],
    });
    expect(problems[0]).toMatch(/never fuzzy/i);
  });

  it("rejects a target that is neither an org nor an owner/repo", () => {
    // The target is interpolated into an API path, so a config that could never
    // parse should fail at doctor time rather than at push time.
    const problems = validateSecrets({
      provider: "env",
      propagating: [{ name: NAME, targets: ["https://github.com/AcmeOrgD"] }],
    });
    expect(problems[0]).toMatch(/neither an organization/i);
  });

  it("rejects an empty targets list", () => {
    // `targets: []` reads as "nowhere", which no operator means. Omitting the
    // field is how you say "any target".
    const problems = validateSecrets({
      provider: "env",
      propagating: [{ name: NAME, targets: [] }],
    });
    expect(problems[0]).toMatch(/non-empty array/i);
  });

  it("rejects a name that is both excluded and propagating", () => {
    // Two contradictory instructions about the same credential. The program
    // refuses at push time; catching it here surfaces it in review instead.
    const problems = validateSecrets({
      provider: "env",
      propagating: [NAME],
      narrow: { excludeKeys: [NAME] },
    });
    expect(problems[0]).toMatch(/opposite things/i);
  });
});

describe("safe vault discovery", () => {
  // The unsafe alternative is `bws secret list -o tsv|table|env`, which prints
  // VALUES — run once to find one key name and every secret in the project is in
  // a terminal, a CI log, or an agent transcript. So the property that matters
  // is not that this prints something useful; it is that it cannot print a value.

  it("reports names and byte counts, never values", () => {
    const rows = describeEnv({
      LINEAR_API_KEY: VALUE,
      NPM_TOKEN: "stand-in-token-value",
      PATH: "/usr/bin",
      HOME: "/root",
    });
    expect(rows).toEqual([
      { name: NAME, bytes: VALUE.length },
      { name: "NPM_TOKEN", bytes: "stand-in-token-value".length },
    ]);
    expect(JSON.stringify(rows)).not.toContain(VALUE);
    expect(JSON.stringify(rows)).not.toContain("stand-in-token-value");
  });

  it("distinguishes an empty secret from an absent one", () => {
    // The distinction discovery is usually run to make: a vault entry set to ""
    // is present, resolves, and silently makes every consumer of it useless.
    expect(describeEnv({ LINEAR_API_KEY: "" })).toEqual([
      { name: NAME, bytes: 0 },
    ]);
    expect(describeEnv({})).toEqual([]);
  });

  it("narrows by prefix without widening to ambient variables", () => {
    const env = { LINEAR_API_KEY: "a", LINEAR_TEAM: "b", NPM_TOKEN: "c" };
    expect(describeEnv(env, "LINEAR").map(row => row.name)).toEqual([
      NAME,
      "LINEAR_TEAM",
    ]);
  });
});
