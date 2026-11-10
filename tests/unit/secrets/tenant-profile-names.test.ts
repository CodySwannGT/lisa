/**
 * Every AWS profile lisa-secrets-access writes is owned — no bare aliases.
 *
 * `~/.aws/config` and `~/.aws/credentials` are shared by every tenant on a
 * workstation. An earlier version also wrote the bundle's own keys unprefixed
 * (`agent-dev`, assuming from a bare `lisa-bootstrap`) as a deprecation
 * window. A bare name is one slot per machine: the first tenant claimed it,
 * and every other tenant's `--profile agent-dev` silently reached the first
 * tenant's accounts. These cases pin that the window is closed, that a stale
 * bare block is cleaned up for its own owner only, and that `agent-dev` and
 * `dev` keys land on one name (CodySwannGT/lisa#4768).
 * @module tests/unit/secrets/tenant-profile-names
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
  canonicalProfileName,
  emitSourceProfileFor,
  renderAwsProfiles,
  stageOf,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/aws-bootstrap.mjs";
import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** The tenant whose profiles these cases write. */
const ACME = "acme";

/** A second tenant on the same machine. */
const GLOBEX = "globex";

/** Acme's canonical dev profile. */
const ACME_DEV = "acme-agent-dev";

/** Acme's canonical dev section header. */
const ACME_DEV_SECTION = `profile ${ACME_DEV}`;

/** Acme's canonical source profile. */
const ACME_SOURCE = "acme-agent-bootstrap";

/** A role line in acme's account. */
const ACME_ROLE = "role_arn = arn:aws:iam::111111111111:role/RemoteAgent";

/** A role line in globex's account. */
const GLOBEX_ROLE = "role_arn = arn:aws:iam::222222222222:role/RemoteAgent";

/** Where the written config lives, relative to home. */
const CONFIG = ".aws/config";

/** Where the source key pair lives, relative to home. */
const KEYS = ".aws/credentials";

/** Scratch homes to remove. */
const homes: string[] = [];

/**
 * A bundle with the given profile keys, all in one account.
 * @param keys The bundle's profile keys.
 * @param account The 12-digit account the roles live in.
 * @returns A bootstrap bundle.
 */
function bundleWith(
  keys: readonly string[],
  account = "111111111111"
): Record<string, unknown> {
  return {
    accessKeyId: "AKIA_ACME",
    secretAccessKey: "fixture-only",
    externalId: "ext-acme",
    profiles: Object.fromEntries(
      keys.map(key => [
        key,
        {
          roleArn: `arn:aws:iam::${account}:role/RemoteAgent`,
          region: "us-east-1",
        },
      ])
    ),
  };
}

/** The infra-kit shape: keys that already begin with `agent-`. */
const AGENT_KEYED = bundleWith(["agent-dev", "agent-production"]);

/**
 * A scratch home with an `.aws` directory.
 * @returns Its path.
 */
function scratchHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-tenant-names-"));
  homes.push(home);
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  return home;
}

/**
 * Every ini section header in a file, in order.
 * @param home Scratch home.
 * @param file Relative file path.
 * @returns Section names without brackets.
 */
function sections(home: string, file: string): string[] {
  const text = readFileSync(path.join(home, file), "utf8");
  return [...text.matchAll(/^\[([^\]\n]+)\]$/gm)].map(found => found[1] ?? "");
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

describe("the canonical name", () => {
  it("maps agent-dev and dev to one <ns>-agent-dev, never -agent-agent-", () => {
    expect(stageOf("agent-dev")).toBe("dev");
    expect(stageOf("dev")).toBe("dev");
    expect(canonicalProfileName(ACME, "agent-dev")).toBe(ACME_DEV);
    expect(canonicalProfileName(ACME, "dev")).toBe(ACME_DEV);
    expect(emitSourceProfileFor(ACME)).toBe(ACME_SOURCE);
  });

  it("renders the same profile names for agent- prefixed and bare keys", () => {
    const prefixed = renderAwsProfiles(AGENT_KEYED, ACME);
    const bare = renderAwsProfiles(bundleWith(["dev", "production"]), ACME);

    expect(prefixed?.profiles).toEqual([ACME_DEV, "acme-agent-production"]);
    expect(bare?.profiles).toEqual(prefixed?.profiles);
    expect(prefixed?.config).not.toContain("-agent-agent-");
  });

  it("refuses a bundle whose keys name the same stage twice", () => {
    expect(() =>
      renderAwsProfiles(bundleWith(["dev", "agent-dev"]), ACME)
    ).toThrow(`both name the profile "${ACME_DEV}"`);
  });

  it("refuses a stage that would shadow the source profile", () => {
    expect(() =>
      renderAwsProfiles(bundleWith(["agent-bootstrap"]), ACME)
    ).toThrow(/reserved for the source profile/);
  });
});

describe("no bare profile names are emitted", () => {
  it("writes only owner-prefixed sections to both files", () => {
    const home = scratchHome();

    installAwsProfiles(AGENT_KEYED, { home, owner: ACME });

    expect(sections(home, CONFIG)).toEqual([
      ACME_DEV_SECTION,
      "profile acme-agent-production",
    ]);
    expect(sections(home, KEYS)).toEqual([ACME_SOURCE]);
    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).not.toMatch(/source_profile = lisa-bootstrap$/m);
  });

  it("ignores the retired opt-out and claim switches", () => {
    // Both env vars used to steer the bare aliases. They are no-ops now, so a
    // workstation that still exports either gets exactly the owned names.
    const home = scratchHome();
    const before = {
      no: process.env.LISA_SECRETS_NO_LEGACY_PROFILES,
      claim: process.env.LISA_SECRETS_CLAIM_LEGACY_PROFILES,
    };
    process.env.LISA_SECRETS_NO_LEGACY_PROFILES = "0";
    process.env.LISA_SECRETS_CLAIM_LEGACY_PROFILES = "1";
    try {
      installAwsProfiles(AGENT_KEYED, { home, owner: ACME });
    } finally {
      for (const [key, value] of [
        ["LISA_SECRETS_NO_LEGACY_PROFILES", before.no],
        ["LISA_SECRETS_CLAIM_LEGACY_PROFILES", before.claim],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(sections(home, KEYS)).toEqual([ACME_SOURCE]);
    expect(sections(home, CONFIG)).not.toContain("profile agent-dev");
  });

  it("reports only the owned names as written", () => {
    expect(
      installAwsProfiles(AGENT_KEYED, { home: scratchHome(), owner: ACME })
    ).toEqual([ACME_DEV, "acme-agent-production"]);
  });
});

describe("a stale bare alias block left by a previous version", () => {
  /** Acme's block as the deprecation-window version wrote it. */
  const STALE_ACME_CONFIG = [
    "# >>> managed by lisa-secrets-access v3 owner=acme >>>",
    "[profile acme-agent-dev]",
    ACME_ROLE,
    "source_profile = acme-lisa-bootstrap",
    "",
    "[profile agent-dev]",
    ACME_ROLE,
    "source_profile = lisa-bootstrap",
    "# <<< managed by lisa-secrets-access v3 owner=acme <<<",
  ].join("\n");

  /** Globex's block, which happens to hold the bare names too. */
  const GLOBEX_CONFIG = [
    `# >>> managed by lisa-secrets-access v3 owner=${GLOBEX} >>>`,
    "[profile globex-agent-dev]",
    GLOBEX_ROLE,
    "source_profile = globex-lisa-bootstrap",
    "",
    "[profile staging]",
    GLOBEX_ROLE,
    "source_profile = lisa-bootstrap",
    `# <<< managed by lisa-secrets-access v3 owner=${GLOBEX} <<<`,
  ].join("\n");

  /** An operator's own, unmanaged sections. */
  const OPERATOR_CONFIG = [
    "[default]",
    "region = us-east-1",
    "",
    "[profile mine-sso]",
    "sso_session = mine",
  ].join("\n");

  const STALE_ACME_KEYS = [
    "# >>> managed by lisa-secrets-access v3 owner=acme >>>",
    "[acme-lisa-bootstrap]",
    "aws_access_key_id = AKIA_OLD",
    "aws_secret_access_key = old",
    "",
    "[lisa-bootstrap]",
    "aws_access_key_id = AKIA_OLD",
    "aws_secret_access_key = old",
    "# <<< managed by lisa-secrets-access v3 owner=acme <<<",
  ].join("\n");

  const GLOBEX_KEYS = [
    `# >>> managed by lisa-secrets-access v3 owner=${GLOBEX} >>>`,
    "[globex-lisa-bootstrap]",
    "aws_access_key_id = AKIA_GLOBEX",
    "aws_secret_access_key = globex",
    `# <<< managed by lisa-secrets-access v3 owner=${GLOBEX} <<<`,
  ].join("\n");

  const OPERATOR_KEYS = ["[mine]", "aws_access_key_id = AKIA_MINE"].join("\n");

  /**
   * Seed a home with acme's stale block between operator and globex content.
   * @returns The home.
   */
  function seeded(): string {
    const home = scratchHome();
    writeFileSync(
      path.join(home, CONFIG),
      `${OPERATOR_CONFIG}\n\n${STALE_ACME_CONFIG}\n\n${GLOBEX_CONFIG}\n`
    );
    writeFileSync(
      path.join(home, KEYS),
      `${OPERATOR_KEYS}\n\n${STALE_ACME_KEYS}\n\n${GLOBEX_KEYS}\n`
    );
    return home;
  }

  it("is removed for its own owner when the owner's block is rewritten", () => {
    const home = seeded();

    installAwsProfiles(AGENT_KEYED, { home, owner: ACME });

    const config = sections(home, CONFIG);
    expect(config).not.toContain("profile agent-dev");
    expect(config).toContain(ACME_DEV_SECTION);
    const keys = sections(home, KEYS);
    expect(keys).not.toContain("lisa-bootstrap");
    expect(keys).not.toContain("acme-lisa-bootstrap");
    expect(keys).toContain(ACME_SOURCE);
    expect(readFileSync(path.join(home, CONFIG), "utf8")).not.toContain(
      "source_profile = acme-lisa-bootstrap"
    );
  });

  it("leaves another owner's block and operator sections byte-for-byte", () => {
    const home = seeded();

    installAwsProfiles(AGENT_KEYED, { home, owner: ACME });

    const config = readFileSync(path.join(home, CONFIG), "utf8");
    const keys = readFileSync(path.join(home, KEYS), "utf8");
    expect(config).toContain(GLOBEX_CONFIG);
    expect(config.startsWith(`${OPERATOR_CONFIG}\n`)).toBe(true);
    expect(keys).toContain(GLOBEX_KEYS);
    expect(keys.startsWith(`${OPERATOR_KEYS}\n`)).toBe(true);
  });
});

describe("sections the remote-agent writer left for the same owner", () => {
  /** What `aws configure set` leaves: plain, unmarked sections. */
  const REMOTE_CONFIG = [
    "[profile acme-agent-dev]",
    ACME_ROLE,
    "source_profile = acme-agent-bootstrap",
    "role_session_name = codex",
    "",
    "[profile acme-agent-agent-production]",
    ACME_ROLE,
    "source_profile = acme-agent-bootstrap",
    "",
    "[profile globex-agent-dev]",
    GLOBEX_ROLE,
    "source_profile = globex-agent-bootstrap",
    "",
    "[profile mine-sso]",
    "sso_session = mine",
    "",
  ].join("\n");

  const REMOTE_KEYS = [
    "[acme-agent-bootstrap]",
    "aws_access_key_id = AKIA_ACME",
    "aws_secret_access_key = fixture-only",
    "",
    "[globex-agent-bootstrap]",
    "aws_access_key_id = AKIA_GLOBEX",
    "aws_secret_access_key = globex",
    "",
  ].join("\n");

  it("are adopted instead of refused, including the doubled spelling", () => {
    const home = scratchHome();
    writeFileSync(path.join(home, CONFIG), REMOTE_CONFIG);
    writeFileSync(path.join(home, KEYS), REMOTE_KEYS);

    expect(() =>
      installAwsProfiles(AGENT_KEYED, { home, owner: ACME })
    ).not.toThrow();

    const config = sections(home, CONFIG);
    expect(config.filter(name => name === ACME_DEV_SECTION)).toHaveLength(1);
    expect(config).not.toContain("profile acme-agent-agent-production");
    expect(config).toContain("profile globex-agent-dev");
    expect(config).toContain("profile mine-sso");
    const keys = sections(home, KEYS);
    expect(keys.filter(name => name === ACME_SOURCE)).toHaveLength(1);
    expect(keys).toContain("globex-agent-bootstrap");
  });
});
