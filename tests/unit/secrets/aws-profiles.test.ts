/**
 * Each environment is a SEPARATE AWS account, reached by assuming a role.
 *
 * The bootstrap bundle has always carried a `profiles` map — one `roleArn` per
 * environment — plus the `externalId` those roles require. Nothing consumed any
 * of it, so `--profile agent-dev` failed with "profile not found" and every call
 * fell back to the bootstrap identity in the shared account. That identity can
 * assume roles and nothing else, which is why `aws sts get-caller-identity`
 * could succeed while real work had no permissions anywhere.
 * @module tests/unit/secrets/aws-profiles
 */

import { describe, expect, it } from "vitest";

import {
  deriveAwsEnvironment,
  BOOTSTRAP_KEY,
  readProfiles,
  renderAwsProfiles,
  sourceProfileFor,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/aws-bootstrap.mjs";

/** The project every profile below belongs to. */
const OWNER = "acmeco";

/** The source profile that project's roles assume from. */
const SOURCE = sourceProfileFor(OWNER);

/** The dev stage as it lands in `~/.aws/config`, once owned. */
const DEV_SECTION = `${OWNER}-agent-dev`;

/** The four environments, shaped as the real bundle stores them. */
const PROFILES = {
  "agent-dev": {
    roleArn: "arn:aws:iam::123456789012:role/RemoteAgent",
    region: "us-east-1",
  },
  "agent-staging": {
    roleArn: "arn:aws:iam::345678901234:role/RemoteAgent",
    region: "us-east-1",
  },
  "agent-production": {
    roleArn: "arn:aws:iam::210987654321:role/RemoteAgent",
    region: "us-east-1",
  },
  "agent-shared": {
    roleArn: "arn:aws:iam::456789012345:role/RemoteAgent",
    region: "us-east-1",
  },
};

/** A bundle whose `profiles` is an object. */
const BUNDLE = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cret",
  roleName: "RemoteAgent",
  externalId: "ext-123",
  profiles: PROFILES,
};

/**
 * Wrap a bundle the way a selected secret set carries it.
 * @param bundle The bundle object.
 * @returns A selection map.
 */
function selection(bundle: unknown): Map<string, { value: string }> {
  return new Map([[BOOTSTRAP_KEY, { value: JSON.stringify(bundle) }]]);
}

describe("readProfiles", () => {
  it("accepts a profiles map stored as a JSON STRING", () => {
    // The real bundle double-encodes it. A plain `typeof === "object"` check
    // yields zero profiles and every environment silently disappears — which is
    // worse than throwing, because everything still "works" as the assume-only
    // identity with no permissions.
    expect(
      readProfiles({ ...BUNDLE, profiles: JSON.stringify(PROFILES) })
    ).toEqual(PROFILES);
  });

  it("accepts a profiles map stored as an object", () => {
    expect(readProfiles(BUNDLE)).toEqual(PROFILES);
  });

  it("treats unparseable or absent profiles as none", () => {
    expect(readProfiles({ profiles: "{not json" })).toEqual({});
    expect(readProfiles({})).toEqual({});
    expect(readProfiles(null)).toEqual({});
  });
});

describe("renderAwsProfiles", () => {
  it("writes one profile per environment, each assuming from the source", () => {
    const rendered = renderAwsProfiles(BUNDLE, OWNER);

    // Every name carries its owner. Bare stage names name a stage and no owner,
    // so two projects on one machine wrote — and silently replaced — the same
    // four sections.
    expect(rendered?.profiles).toEqual([
      DEV_SECTION,
      "acmeco-agent-staging",
      "acmeco-agent-production",
      "acmeco-agent-shared",
    ]);
    expect(rendered?.config).toContain(`[profile ${DEV_SECTION}]`);
    expect(rendered?.config).toContain(
      "role_arn = arn:aws:iam::123456789012:role/RemoteAgent"
    );
    expect(rendered?.config).toContain(`source_profile = ${SOURCE}`);
  });

  it("carries the external id the roles require", () => {
    // Without it every assume-role call is denied, and the error names trust
    // policy rather than a missing field — expensive to diagnose.
    expect(renderAwsProfiles(BUNDLE, OWNER)?.config).toContain(
      "external_id = ext-123"
    );
  });

  it("puts the key pair in the source profile, not a default one", () => {
    // `default` would be picked up by any call that names no profile, silently
    // running as an identity that can only assume roles.
    const rendered = renderAwsProfiles(BUNDLE, OWNER);

    expect(rendered?.credentials).toContain(`[${SOURCE}]`);
    expect(rendered?.credentials).not.toContain("[default]");
  });

  it("refuses a bundle with no usable key pair", () => {
    expect(renderAwsProfiles({ profiles: PROFILES }, OWNER)).toBeNull();
    expect(renderAwsProfiles(null, OWNER)).toBeNull();
  });

  it("skips a name that cannot round-trip as an ini header", () => {
    // A `]` truncates the header and a newline injects extra lines, so the
    // written config would not mean what it appears to. Names were also being
    // recovered by re-parsing the rendered text, which made this corrupting
    // rather than merely wrong.
    const rendered = renderAwsProfiles(
      {
        ...BUNDLE,
        profiles: {
          "bad]name": { roleArn: "arn:aws:iam::1:role/X" },
          "with\nnewline": { roleArn: "arn:aws:iam::2:role/X" },
          "agent-dev": PROFILES["agent-dev"],
        },
      },
      OWNER
    );

    expect(rendered?.profiles).toEqual([DEV_SECTION]);
    expect(rendered?.config).not.toContain("bad]name");
  });

  it("returns names collected in the loop, not re-parsed from its output", () => {
    // Guards the specific regression: if the header format changes, the names
    // must still be right.
    const rendered = renderAwsProfiles(BUNDLE, OWNER);

    for (const name of rendered?.profiles ?? []) {
      expect(rendered?.config).toContain(`[profile ${name}]`);
    }
  });

  it("skips a profile entry with no role", () => {
    const rendered = renderAwsProfiles(
      {
        ...BUNDLE,
        profiles: {
          broken: { region: "us-east-1" },
          "agent-dev": PROFILES["agent-dev"],
        },
      },
      OWNER
    );

    expect(rendered?.profiles).toEqual([DEV_SECTION]);
  });
});

describe("the default profile a session selects", () => {
  it("defaults to a dev profile", () => {
    expect(
      deriveAwsEnvironment(selection(BUNDLE), OWNER).get("AWS_PROFILE")?.value
    ).toBe(DEV_SECTION);
  });

  it("never defaults to production", () => {
    // An implicit production profile is one careless command away from a bad
    // afternoon. Production must be named deliberately.
    const noDev = {
      ...BUNDLE,
      profiles: {
        "agent-production": PROFILES["agent-production"],
        "agent-staging": PROFILES["agent-staging"],
      },
    };

    expect(
      deriveAwsEnvironment(selection(noDev), OWNER).get("AWS_PROFILE")?.value
    ).toBe("acmeco-agent-staging");
  });

  it("selects nothing when the bundle declares no profiles", () => {
    expect(
      deriveAwsEnvironment(
        selection({ ...BUNDLE, profiles: undefined }),
        OWNER
      ).has("AWS_PROFILE")
    ).toBe(false);
  });

  it("never overrides a profile the store itself supplies", () => {
    const selected = selection(BUNDLE);
    selected.set("AWS_PROFILE", { value: "chosen-by-operator" });

    expect(deriveAwsEnvironment(selected, OWNER).has("AWS_PROFILE")).toBe(
      false
    );
  });
});
