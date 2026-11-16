/**
 * Tests for deriving AWS variables from the bootstrap bundle.
 *
 * `LISA_AWS_BOOTSTRAP_JSON` is a name no AWS SDK reads. Materializing it alone
 * leaves a session whose credential is present and unusable — and worse than
 * unusable, because a Claude cloud container ships its own stale
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, and environment variables
 * outrank profile files in the credential chain. A real session failed exactly
 * that way:
 *
 *     InvalidClientTokenId: The security token included in the request is invalid.
 * @module tests/unit/secrets/aws-bootstrap-derivation
 */

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_KEY,
  deriveAwsEnvironment,
  parseBootstrap,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/aws-bootstrap.mjs";

/** The example access key id, repeated across cases. */
const KEY_ID = "AKIAEXAMPLE";

/** The example secret half. */
const SECRET = "s3cret-example";

/** A realistic bundle: assume-only user plus the roles it may assume. */
const BUNDLE = JSON.stringify({
  accessKeyId: KEY_ID,
  secretAccessKey: SECRET,
  roleName: "RemoteAgent",
  externalId: "example-external-id",
  // Shaped as the real bundle stores it: each entry names a role to assume in
  // that environment's own account. An earlier fixture mapped names to bare
  // account-id strings, which no code path can turn into a profile — so it
  // silently exercised the no-usable-profiles branch while claiming to cover
  // the normal one.
  profiles: {
    dev: {
      roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
      region: "us-east-1",
    },
    production: { roleArn: "arn:aws:iam::222222222222:role/RemoteAgent" },
  },
});

/** A bundle whose profiles cannot produce a single usable entry. */
const BUNDLE_NO_PROFILES = JSON.stringify({
  accessKeyId: KEY_ID,
  secretAccessKey: SECRET,
  roleName: "RemoteAgent",
});

/**
 * Build a selected-secrets map.
 * @param entries Name to value.
 * @returns The map materialize() would hold.
 */
const selection = (
  entries: Record<string, string>
): Map<string, { value: string }> =>
  new Map(Object.entries(entries).map(([k, v]) => [k, { value: v }]));

/** The project these derived variables belong to. */
const OWNER = "acmeco";

describe("parseBootstrap", () => {
  it("parses a well-formed bundle", () => {
    expect(parseBootstrap(BUNDLE)?.roleName).toBe("RemoteAgent");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["empty", ""],
    ["a bare string", '"just-a-string"'],
  ])("treats %s as absent rather than throwing", (_label, raw) => {
    // A parse failure must not take materialization down with it: every other
    // secret in the run is still valid, and a session with most of its
    // credentials beats a session with none.
    expect(parseBootstrap(raw)).toBeNull();
  });
});

describe("deriveAwsEnvironment", () => {
  it("does NOT export the raw key pair", () => {
    // It used to, to out-shout the ambient pair a container injects. That made
    // every call run as the bootstrap identity, because exported environment
    // credentials outrank AWS_PROFILE — so the per-environment profiles existed
    // and were never used. The pair now lives in ~/.aws/credentials as the
    // source profile, and the ambient one is unset rather than overridden.
    const derived = deriveAwsEnvironment(
      selection({ [BOOTSTRAP_KEY]: BUNDLE }),
      OWNER
    );

    expect(derived.has("AWS_ACCESS_KEY_ID")).toBe(false);
    expect(derived.has("AWS_SECRET_ACCESS_KEY")).toBe(false);
  });

  it("falls back to the pair when no usable profile exists", () => {
    // Withholding the pair is only safe because a profile supersedes it. With
    // no profile to select — and the managed shell block unsetting the ambient
    // pair — withholding it too would leave the session with NO credentials at
    // all. A degraded session beats a dead one.
    const derived = deriveAwsEnvironment(
      selection({ [BOOTSTRAP_KEY]: BUNDLE_NO_PROFILES }),
      OWNER
    );

    expect(derived.get("AWS_ACCESS_KEY_ID")?.value).toBe(KEY_ID);
    expect(derived.get("AWS_SECRET_ACCESS_KEY")?.value).toBe(SECRET);
    expect(derived.has("AWS_PROFILE")).toBe(false);
    // And it must say why, so the empty `profiles` map is findable.
    expect(derived.get("AWS_ACCESS_KEY_ID")?.note ?? "").toContain("profiles");
  });

  it("yields nothing when the bundle is absent", () => {
    expect(deriveAwsEnvironment(selection({ OTHER: "x" }), OWNER).size).toBe(0);
  });

  it("yields nothing when the bundle is malformed", () => {
    expect(
      deriveAwsEnvironment(selection({ [BOOTSTRAP_KEY]: "{broken" }), OWNER)
        .size
    ).toBe(0);
  });

  it("refuses half a credential", () => {
    // Half a credential is not a weaker credential; it is a confusing failure.
    // The SDK reports a signature error rather than a missing one.
    const half = JSON.stringify({ accessKeyId: KEY_ID });
    expect(
      deriveAwsEnvironment(selection({ [BOOTSTRAP_KEY]: half }), OWNER).size
    ).toBe(0);
  });

  it("never overrides names the secret store itself supplies", () => {
    // A project storing these under their own names has stated an explicit
    // intent. Overriding it would be this module guessing against an operator.
    const derived = deriveAwsEnvironment(
      selection({
        [BOOTSTRAP_KEY]: BUNDLE,
        AWS_ACCESS_KEY_ID: "AKIAFROMSTORE",
        AWS_SECRET_ACCESS_KEY: "from-store",
      }),
      OWNER
    );
    expect(derived.size).toBe(0);
  });

  it("carries a region through when the bundle names one", () => {
    const withRegion = JSON.stringify({
      accessKeyId: KEY_ID,
      secretAccessKey: SECRET,
      region: "us-east-1",
    });
    const derived = deriveAwsEnvironment(
      selection({ [BOOTSTRAP_KEY]: withRegion }),
      OWNER
    );
    expect(derived.get("AWS_DEFAULT_REGION")?.value).toBe("us-east-1");
  });

  it("does not mutate the selection it was given", () => {
    // The caller decides what to merge and what to report; a function that
    // edited its input would make that choice invisible.
    const input = selection({ [BOOTSTRAP_KEY]: BUNDLE });
    deriveAwsEnvironment(input, OWNER);
    expect([...input.keys()]).toEqual([BOOTSTRAP_KEY]);
  });
});
