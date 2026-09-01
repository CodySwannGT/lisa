/**
 * Two Lisa projects on one machine must not consume each other's credentials.
 *
 * The materializer guarded against an OPERATOR's own profiles and against its
 * own previous output, and those two cases exhausted its notion of ownership.
 * "Our own previous output is meant to be replaced" was never qualified by
 * whose: a second tenant's run matched the same unowned marker, stripped the
 * first tenant's block, and wrote its own in the same place.
 *
 * Measured against the pre-fix module with two synthetic bundles declaring the
 * same stage names: `~/.aws/config` ended with 2 profiles rather than 4, the
 * surviving `agent-dev` pointed at the second tenant's account, the source key
 * pair was the second tenant's, and `~/.bashrc` sourced the second tenant's
 * `secrets.env` for every shell on the machine — including the first tenant's
 * sessions. Both runs exited 0 and both reported writing their own profiles.
 *
 * Nothing about the surviving profile is malformed. It is a real, working
 * profile that belongs to someone else, so no property check on the profile can
 * detect it — only a comparison against the intended owner fires.
 * @module tests/unit/secrets/cross-project-collisions
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

import { deriveAwsEnvironment } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/aws-bootstrap.mjs";
import {
  installAwsProfiles,
  installProfileSourcing,
  legacyManagedProfiles,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** The first tenant on the machine. */
const ALPHA = "alphaco";

/** The second tenant on the same machine. */
const BETA = "betaco";

/** Where the written config lives, relative to home. */
const CONFIG = ".aws/config";

/** Where the source key pair lives, relative to home. */
const KEYS = ".aws/credentials";

/** Scratch homes to remove. */
const homes: string[] = [];

/** The bare stage section a pre-ownership build wrote. */
const LEGACY_SECTION = "[profile agent-dev]";

/** The section this fix writes for beta instead. */
const BETA_SECTION = "[profile betaco-agent-dev]";

/** Recognises an `~/.aws` managed block of any version. */
const AWS_FAMILY_RE = />>> managed by lisa-secrets-access[^\n]*>>>/g;

/**
 * An `~/.aws/config` holding one pre-ownership block for a given account.
 * @param account The 12-digit account its role ARN names.
 * @returns The file contents.
 */
function legacyConfig(account: string): string {
  return [
    "# >>> managed by lisa-secrets-access v2 >>>",
    LEGACY_SECTION,
    `role_arn = arn:aws:iam::${account}:role/RemoteAgent`,
    "source_profile = lisa-bootstrap",
    "# <<< managed by lisa-secrets-access v2 <<<",
    "",
  ].join("\n");
}

/**
 * Sort names with an explicit comparator, so the order is locale-independent.
 * @param names The names to order.
 * @returns A new, sorted array.
 */
function ordered(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * A bundle declaring the stage names every tenant's bundle declares.
 * @param account The 12-digit account the dev role lives in.
 * @param keyId The access key id, so a replaced pair is visible.
 * @returns A bootstrap bundle.
 */
function bundleFor(account: string, keyId: string): Record<string, unknown> {
  return {
    accessKeyId: keyId,
    secretAccessKey: "fixture-only",
    externalId: `ext-${keyId}`,
    profiles: {
      "agent-dev": {
        roleArn: `arn:aws:iam::${account}:role/RemoteAgent`,
        region: "us-east-1",
      },
      "agent-production": {
        roleArn: `arn:aws:iam::${account}:role/RemoteAgentProd`,
        region: "us-east-1",
      },
    },
  };
}

/** Alpha's bundle. */
const ALPHA_BUNDLE = bundleFor("111111111111", "AKIA_ALPHA");

/** Beta's bundle, declaring identical stage names in a different account. */
const BETA_BUNDLE = bundleFor("222222222222", "AKIA_BETA");

/**
 * A scratch home with an `.aws` directory.
 * @returns Its path.
 */
function scratchHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-crosstenant-"));
  homes.push(home);
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  return home;
}

/**
 * Where a tenant's materialized values live under a given home.
 * @param home Scratch home.
 * @param owner Tenant name.
 * @returns Absolute path to that tenant's `secrets.env`.
 */
function valuesFile(home: string, owner: string): string {
  return path.join(home, ".config", owner, "secrets.env");
}

/**
 * The `[profile …]` section names present in a config file.
 * @param home Scratch home.
 * @returns Every section name, in file order.
 */
function profileSections(home: string): string[] {
  const text = readFileSync(path.join(home, CONFIG), "utf8");
  return [...text.matchAll(/^\[profile ([^\]\n]+)\]/gm)].map(m => m[1].trim());
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

describe("two projects materializing on one machine", () => {
  it("leaves both tenants' AWS profiles intact", () => {
    // Four profiles, not two. Asserted on the file rather than on exit status:
    // the pre-fix path succeeded while overwriting, so exit status distinguishes
    // nothing.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    expect(ordered(profileSections(home))).toEqual([
      "alphaco-agent-dev",
      "alphaco-agent-production",
      "betaco-agent-dev",
      "betaco-agent-production",
    ]);
  });

  it("keeps each tenant's role pointing at its own account", () => {
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).toContain("arn:aws:iam::111111111111:role/RemoteAgent");
    expect(config).toContain("arn:aws:iam::222222222222:role/RemoteAgent");
  });

  it("keeps each tenant's source key pair under its own name", () => {
    // One fixed `[lisa-bootstrap]` section meant the second tenant's key pair
    // replaced the first's, so alpha's profiles assumed from beta's identity.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    const keys = readFileSync(path.join(home, KEYS), "utf8");
    expect(keys).toContain("AKIA_ALPHA");
    expect(keys).toContain("AKIA_BETA");
    expect(keys).toContain(`[${ALPHA}-lisa-bootstrap]`);
    expect(keys).toContain(`[${BETA}-lisa-bootstrap]`);
  });

  it("points each tenant's profiles at its own source profile", () => {
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });

    expect(readFileSync(path.join(home, CONFIG), "utf8")).toContain(
      `source_profile = ${ALPHA}-lisa-bootstrap`
    );
  });

  it("derives an AWS_PROFILE that names a profile actually written", () => {
    // The failure this whole module exists to remove is `--profile x` reporting
    // "profile not found". Namespacing the written names without namespacing
    // the derived selection would reintroduce it.
    const home = scratchHome();

    const written = installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    const selected = new Map([
      [
        "LISA_AWS_BOOTSTRAP_JSON",
        { value: JSON.stringify(ALPHA_BUNDLE), note: "" },
      ],
    ]);

    const derived = deriveAwsEnvironment(selected, ALPHA).get("AWS_PROFILE");
    expect(derived?.value).toBe(`${ALPHA}-agent-dev`);
    expect(written).toContain(derived?.value);
  });

  it("re-running one tenant replaces only its own block", () => {
    // Idempotence must survive the ownership split: a second alpha run must not
    // duplicate alpha, and must not touch beta.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });
    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });

    expect(ordered(profileSections(home))).toEqual([
      "alphaco-agent-dev",
      "alphaco-agent-production",
      "betaco-agent-dev",
      "betaco-agent-production",
    ]);
  });
});

describe("a profile owned by another project", () => {
  /** Owner and stage that render the same section as `alpha` + `co-agent-dev`. */
  const SPLIT_OWNER = "alpha-co";

  /** A bundle whose stage name completes the other owner's prefix. */
  const OVERLAPPING = {
    accessKeyId: "AKIA_OTHER",
    secretAccessKey: "fixture-only",
    profiles: {
      "co-agent-dev": {
        roleArn: "arn:aws:iam::333333333333:role/RemoteAgent",
      },
    },
  };

  it("is refused by name rather than silently consumed", () => {
    // Prefixing makes the ordinary collision impossible; this is the backstop
    // for the case it cannot prevent, where two owners and their stage names
    // reduce to one final section — "alpha-co" + "agent-dev" and "alpha" +
    // "co-agent-dev" are both `alpha-co-agent-dev`.
    const home = scratchHome();

    installAwsProfiles(bundleFor("111111111111", "AKIA_SPLIT"), {
      home,
      owner: SPLIT_OWNER,
    });

    expect(() =>
      installAwsProfiles(OVERLAPPING, { home, owner: "alpha" })
    ).toThrow(new RegExp(SPLIT_OWNER));
  });

  it("leaves the other project's file byte-identical when it refuses", () => {
    const home = scratchHome();

    installAwsProfiles(bundleFor("111111111111", "AKIA_SPLIT"), {
      home,
      owner: SPLIT_OWNER,
    });
    const before = readFileSync(path.join(home, CONFIG), "utf8");

    expect(() =>
      installAwsProfiles(OVERLAPPING, { home, owner: "alpha" })
    ).toThrow();

    expect(readFileSync(path.join(home, CONFIG), "utf8")).toBe(before);
  });
});

describe("the shell sourcing block, which cannot be namespaced", () => {
  it("refuses to redirect a machine already serving another tenant", () => {
    // `~/.bashrc` exports into EVERY shell; there is no name a consumer selects,
    // so distinct names cannot help. Taking it over silently is what handed
    // alpha's sessions beta's credentials.
    const home = scratchHome();

    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });

    expect(() =>
      installProfileSourcing(valuesFile(home, BETA), { home, owner: BETA })
    ).toThrow(new RegExp(ALPHA));
  });

  it("leaves the existing block untouched when it refuses", () => {
    const home = scratchHome();

    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });
    const before = readFileSync(path.join(home, ".bashrc"), "utf8");

    expect(() =>
      installProfileSourcing(valuesFile(home, BETA), { home, owner: BETA })
    ).toThrow();

    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toBe(before);
    expect(before).toContain(`/.config/${ALPHA}/secrets.env`);
  });

  it("takes over under an explicit claim, leaving exactly one block", () => {
    const home = scratchHome();

    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });
    installProfileSourcing(valuesFile(home, BETA), {
      home,
      owner: BETA,
      claimShell: true,
    });

    const bashrc = readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(bashrc).toContain(`/.config/${BETA}/secrets.env`);
    expect(bashrc).not.toContain(`/.config/${ALPHA}/secrets.env`);
    expect(bashrc.match(/# >>> lisa secrets \(managed/g)).toHaveLength(1);
  });

  it("re-running the same tenant is idempotent", () => {
    const home = scratchHome();

    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });
    const first = readFileSync(path.join(home, ".bashrc"), "utf8");
    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });

    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toBe(first);
  });
});

describe("a block written before ownership existed", () => {
  /**
   * A v2 shell block, as shipped before this fix, sourcing one tenant's values.
   * @param home Scratch home.
   * @param owner The tenant whose values file it loads.
   * @returns The file contents.
   */
  function legacyShellBlock(home: string, owner: string): string {
    return [
      "# >>> lisa secrets (managed v2) >>>",
      "unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN",
      `if [ -f "${valuesFile(home, owner)}" ]; then`,
      "  set -a",
      `  . "${valuesFile(home, owner)}"`,
      "  set +a",
      "fi",
      "# <<< lisa secrets (managed v2) <<<",
      "",
    ].join("\n");
  }

  it("is claimed by the tenant whose values file it names", () => {
    // A legacy shell block carries its own owner in the path it sources, so the
    // ambiguity that forces report-and-flag elsewhere does not exist here.
    const home = scratchHome();
    writeFileSync(path.join(home, ".bashrc"), legacyShellBlock(home, ALPHA));

    installProfileSourcing(valuesFile(home, ALPHA), { home, owner: ALPHA });

    const bashrc = readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(bashrc.match(/# >>> lisa secrets \(managed/g)).toHaveLength(1);
    expect(bashrc).toContain("owner=alphaco");
  });

  it("is refused by a different tenant, naming the tenant it belongs to", () => {
    const home = scratchHome();
    writeFileSync(path.join(home, ".bashrc"), legacyShellBlock(home, ALPHA));

    expect(() =>
      installProfileSourcing(valuesFile(home, BETA), { home, owner: BETA })
    ).toThrow(new RegExp(ALPHA));
  });

  it("is claimed in place when its role ARNs name this project's accounts", () => {
    // The orphan doctrine still holds for the ordinary upgrade. A block left by
    // the previous build names the accounts this bundle names, so it IS this
    // project's own past output — replaced in place, leaving nothing behind for
    // a later reader to mistake for the live one.
    const home = scratchHome();
    writeFileSync(path.join(home, CONFIG), legacyConfig("222222222222"));

    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).not.toContain(LEGACY_SECTION);
    expect(config).toContain(BETA_SECTION);
    expect(config.match(AWS_FAMILY_RE)).toHaveLength(1);
  });

  it("reports unowned AWS profiles by name instead of deleting them", () => {
    // Unlike the shell block, a legacy `~/.aws` block carries no tell of who
    // wrote it — the stage names name a stage and no owner. Deleting it could
    // remove another tenant's working profiles, so it is reported, and removed
    // only under an explicit flag.
    const home = scratchHome();
    writeFileSync(path.join(home, CONFIG), legacyConfig("999999999999"));

    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    expect(legacyManagedProfiles(path.join(home, ".aws"))).toEqual([
      "agent-dev",
    ]);
    expect(readFileSync(path.join(home, CONFIG), "utf8")).toContain(
      LEGACY_SECTION
    );
  });

  it("removes unowned AWS profiles only under an explicit prune", () => {
    const home = scratchHome();
    writeFileSync(path.join(home, CONFIG), legacyConfig("999999999999"));

    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA, pruneLegacy: true });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).not.toContain(LEGACY_SECTION);
    expect(config).toContain(BETA_SECTION);
  });
});

describe("an owner that cannot be resolved", () => {
  it("writes no AWS profiles at all", () => {
    const home = scratchHome();

    expect(() => installAwsProfiles(ALPHA_BUNDLE, { home })).toThrow(
      /which project these credentials belong to/i
    );
    expect(() => readFileSync(path.join(home, CONFIG), "utf8")).toThrow();
  });

  it("writes no shell sourcing block at all", () => {
    const home = scratchHome();

    expect(() =>
      installProfileSourcing(valuesFile(home, ALPHA), { home })
    ).toThrow(/which project these credentials belong to/i);
    expect(() => readFileSync(path.join(home, ".bashrc"), "utf8")).toThrow();
  });

  it("refuses an owner that is not one safe name segment", () => {
    const home = scratchHome();

    expect(() =>
      installAwsProfiles(ALPHA_BUNDLE, { home, owner: "  " })
    ).toThrow(/which project these credentials belong to/i);
  });
});
