/**
 * The deprecated bare profile names must keep resolving during the window.
 *
 * Owning every credential path renamed what this writer emits. Generators
 * outside this repository emit the bare `<stage>` family and the bare
 * `lisa-bootstrap` source profile independently, and scripts there name them
 * directly, so emitting only the owned names would leave writer and reader
 * disagreeing: a bare profile assuming from a source profile that no longer
 * exists resolves to nothing at all.
 *
 * The window is not a fix. The bare family is one shared slot on a machine that
 * may serve several projects, which is the collision the owned names remove;
 * these cases pin that it is refused loudly rather than taken silently.
 * @module tests/unit/secrets/legacy-profile-resolution
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emitSourceProfileFor,
  renderAwsProfiles,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/aws-bootstrap.mjs";
import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/** The first tenant on the machine. */
const ALPHA = "alphaco";

/** The second tenant on the same machine. */
const BETA = "betaco";

/** Where the written config lives, relative to home. */
const CONFIG = ".aws/config";

/** Where the source key pair lives, relative to home. */
const KEYS = ".aws/credentials";

/** The bare source profile an unmigrated reader assumes from. */
const BARE_SOURCE = "lisa-bootstrap";

/** The bare stage name an unmigrated reader selects. */
const BARE_DEV = "agent-dev";

/** Scratch homes to remove. */
const homes: string[] = [];

/**
 * A bundle declaring the stage names every tenant's bundle declares.
 * @param account The 12-digit account its roles live in.
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
  const home = mkdtempSync(path.join(tmpdir(), "lisa-legacycompat-"));
  homes.push(home);
  mkdirSync(path.join(home, ".aws"), { recursive: true });
  return home;
}

/**
 * The `[profile ...]` section names present in a config file.
 * @param home Scratch home.
 * @returns Every section name, in file order.
 */
function profileSections(home: string): string[] {
  const text = readFileSync(path.join(home, CONFIG), "utf8");
  return [...text.matchAll(/^\[profile ([^\]\n]+)\]/gm)].map(m => m[1].trim());
}

/**
 * Read one setting from a named profile section.
 * @param home Scratch home.
 * @param name The profile section to read.
 * @param key The setting name.
 * @returns Its value, or undefined when absent.
 */
function settingOf(
  home: string,
  name: string,
  key: string
): string | undefined {
  const lines = readFileSync(path.join(home, CONFIG), "utf8").split("\n");
  const start = lines.indexOf(`[profile ${name}]`);
  if (start === -1) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("[")) return undefined;
    if (line.startsWith(`${key} = `)) return line.slice(key.length + 3).trim();
  }
  return undefined;
}

/**
 * The `source_profile` a named profile assumes from.
 * @param home Scratch home.
 * @param name The profile section to read.
 * @returns The source profile, or undefined.
 */
function sourceProfileOf(home: string, name: string): string | undefined {
  return settingOf(home, name, "source_profile");
}

/**
 * The bare source-profile sections present in a credentials file.
 * @param text File contents.
 * @returns Every matching section header.
 */
function bareSourceSections(text: string): string[] {
  return [...text.matchAll(new RegExp(`^\\[${BARE_SOURCE}\\]$`, "gm"))].map(
    found => found[0]
  );
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

describe("the deprecated bare profile names", () => {
  it("still resolve for a caller that has not migrated", () => {
    // The break this window exists to prevent. Generators outside this
    // repository emit the bare `<stage>` family and the bare source profile,
    // and scripts there name them directly. Nothing co-ordinates a rename
    // across repositories, so emitting only the owned names would leave a bare
    // profile assuming from a source profile that no longer exists.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });

    // The bare profile exists, and the section it assumes from exists too —
    // asserted as a resolution chain rather than as two independent strings,
    // because half the family present is the failure being guarded.
    expect(sourceProfileOf(home, BARE_DEV)).toBe(BARE_SOURCE);
    expect(readFileSync(path.join(home, KEYS), "utf8")).toContain(
      `[${BARE_SOURCE}]`
    );
  });

  it("reach the same role as the owned name they shadow", () => {
    // A compatibility name that resolved somewhere subtly different would be a
    // second credential wearing a shim's clothes.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });

    // Compared field by field against the owned name it shadows, rather than by
    // counting occurrences — a shim that reached a DIFFERENT role would still
    // produce the right count.
    for (const key of ["role_arn", "external_id", "region"]) {
      expect(settingOf(home, "agent-dev", key)).toBe(
        settingOf(home, `${ALPHA}-agent-dev`, key)
      );
    }
    expect(settingOf(home, "agent-dev", "role_arn")).toBe(
      "arn:aws:iam::111111111111:role/RemoteAgent"
    );
  });

  it("are regenerated, not accumulated, across repeated runs", () => {
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    const first = readFileSync(path.join(home, CONFIG), "utf8");
    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });

    expect(readFileSync(path.join(home, CONFIG), "utf8")).toBe(first);
  });

  it("cannot be silently claimed by a second project", () => {
    // The bare family is ONE shared slot, so the collision this change removes
    // from the owned names is only deferred, never fixed, on the bare ones.
    // What must not happen is the second project taking them silently: its
    // unmigrated scripts would then resolve into the first project's account
    // and report success.
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, { home, owner: BETA });

    // Beta's owned profiles landed — the fix is never withheld.
    expect(profileSections(home)).toContain("betaco-agent-dev");
    // The bare slot still belongs to alpha, pointing at alpha's account.
    expect(sourceProfileOf(home, BARE_DEV)).toBe(BARE_SOURCE);
    const config = readFileSync(path.join(home, CONFIG), "utf8");
    expect(config).not.toContain(
      `arn:aws:iam::222222222222:role/RemoteAgent\nsource_profile = ${BARE_SOURCE}`
    );
    // And beta wrote exactly one source profile: its own, owned one.
    const keys = readFileSync(path.join(home, KEYS), "utf8");
    expect(bareSourceSections(keys)).toHaveLength(1);
    expect(keys).toContain(`[${BETA}-${BARE_SOURCE}]`);
  });

  it("go to the second project only under an explicit claim", () => {
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA });
    installAwsProfiles(BETA_BUNDLE, {
      home,
      owner: BETA,
      claimResolveOnly: true,
    });

    const keys = readFileSync(path.join(home, KEYS), "utf8");
    expect(bareSourceSections(keys)).toHaveLength(2);
  });

  it("are omitted entirely for a caller that has migrated", () => {
    const home = scratchHome();

    installAwsProfiles(ALPHA_BUNDLE, {
      home,
      owner: ALPHA,
      noResolveOnly: true,
    });

    expect(profileSections(home)).toEqual([
      "alphaco-agent-dev",
      "alphaco-agent-production",
    ]);
    expect(readFileSync(path.join(home, KEYS), "utf8")).not.toContain(
      `\n[${BARE_SOURCE}]`
    );
  });
});

describe("the emit path is untouched by the resolve window", () => {
  // The distinction the whole shim turns on. Keeping the bare names RESOLVING
  // is not the same guarantee as EMITTING them, and a reader who conflates the
  // two concludes the rename never happened. These assert the negative: no bare
  // name is ever canonical output.

  it("emits only namespaced profile names", () => {
    const rendered = renderAwsProfiles(ALPHA_BUNDLE, ALPHA);

    expect(rendered?.profiles).toEqual([
      `${ALPHA}-agent-dev`,
      `${ALPHA}-agent-production`,
    ]);
    for (const name of rendered?.profiles ?? []) {
      expect(name.startsWith(`${ALPHA}-`)).toBe(true);
    }
  });

  it("writes no bare section into the canonical body", () => {
    const rendered = renderAwsProfiles(ALPHA_BUNDLE, ALPHA);

    for (const stage of ["agent-dev", "agent-production"]) {
      expect(rendered?.config).not.toContain(`[profile ${stage}]`);
    }
    // The bare sections exist — but only in the resolve-only half, which is a
    // separate value the installer may drop without touching canonical output.
    expect(rendered?.resolveOnly.profiles).toEqual([
      "agent-dev",
      "agent-production",
    ]);
  });

  it("emits a canonical source profile that is never the bare one", () => {
    const rendered = renderAwsProfiles(ALPHA_BUNDLE, ALPHA);

    expect(rendered?.credentials).toContain(`[${emitSourceProfileFor(ALPHA)}]`);
    expect(rendered?.credentials).not.toContain(`[${BARE_SOURCE}]`);
    // Every canonical section assumes from the emitted name, so nothing in the
    // canonical body depends on the deprecated one resolving.
    expect(rendered?.config).not.toContain(`source_profile = ${BARE_SOURCE}`);
  });

  it("reports only namespaced names as what it wrote", () => {
    // The installer's return value is what callers key off. Even on a run that
    // did write the resolve-only aliases, they are not reported as output.
    const home = scratchHome();

    expect(installAwsProfiles(ALPHA_BUNDLE, { home, owner: ALPHA })).toEqual([
      `${ALPHA}-agent-dev`,
      `${ALPHA}-agent-production`,
    ]);
    // Proving the run really did write them, so this is not passing by absence.
    expect(sourceProfileOf(home, BARE_DEV)).toBe(BARE_SOURCE);
  });
});
