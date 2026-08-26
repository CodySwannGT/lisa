/**
 * Fail-closed publication tests for remote AWS bootstrap rotations.
 * @module tests/unit/secrets/publish-aws-bootstrap
 */
import { describe, expect, it, vi } from "vitest";

import {
  publishAwsBootstrap,
  validateAwsBootstrap,
  verifyAwsBootstrap,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/publish-aws-bootstrap.mjs";

const profiles = {
  "agent-dev": {
    roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
    region: "us-east-1",
  },
  "agent-production": {
    roleArn: "arn:aws:iam::222222222222:role/RemoteAgent",
    region: "us-west-2",
  },
};

const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";
const PROVIDER_ID = "provider-id";
const EXTERNAL_ID = "external-id";

/**
 * Build one complete synthetic bundle with a distinguishable access key.
 * @param accessKeyId Synthetic access-key id.
 * @returns Serialized bootstrap bundle.
 */
function bundle(accessKeyId: string): string {
  return JSON.stringify({
    accessKeyId,
    secretAccessKey: `secret-for-${accessKeyId}`,
    externalId: EXTERNAL_ID,
    roleName: "RemoteAgent",
    profiles: JSON.stringify(profiles),
  });
}

describe("AWS bootstrap candidate validation", () => {
  it("accepts the double-encoded profiles emitted by CloudFormation", () => {
    const candidate = validateAwsBootstrap(`${bundle("AKIAOLD")}\n`);

    expect(candidate.raw).toBe(bundle("AKIAOLD"));
    expect(candidate.profiles.map(profile => profile.name)).toEqual([
      "agent-dev",
      "agent-production",
    ]);
  });

  it("rejects a partial credential before any provider write", () => {
    const invalid = JSON.stringify({
      accessKeyId: "AKIAPARTIAL",
      externalId: "external-id",
      roleName: "RemoteAgent",
      profiles,
    });

    expect(() => validateAwsBootstrap(invalid)).toThrow("secretAccessKey");
  });

  it("isolates STS verification from ambient AWS credentials", () => {
    const candidate = validateAwsBootstrap(bundle("AKIACANDIDATE"));
    const run = vi.fn(() => "expiry");

    verifyAwsBootstrap(candidate, run);

    expect(run).toHaveBeenCalledTimes(2);
    for (const call of run.mock.calls) {
      const environment = call[2].env;
      expect(environment.AWS_ACCESS_KEY_ID).toBe("AKIACANDIDATE");
      expect(environment.AWS_SECRET_ACCESS_KEY).toBe(
        "secret-for-AKIACANDIDATE"
      );
      expect(environment.AWS_PROFILE).toBeUndefined();
      expect(call[1]).toContain("assume-role");
    }
  });

  it("never includes the external id from a failed child command", () => {
    const candidate = validateAwsBootstrap(bundle("AKIACANDIDATE"));
    const run = vi.fn(() => {
      throw new Error(
        `Command failed: aws sts assume-role --external-id ${EXTERNAL_ID}`
      );
    });

    let failure: unknown;
    try {
      verifyAwsBootstrap(candidate, run);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      "aws sts assume-role could not be executed"
    );
    expect(String(failure)).not.toContain(EXTERNAL_ID);
  });
});

describe("AWS bootstrap publication", () => {
  it("proves write access, verifies before and after, then reads back exactly", () => {
    const oldValue = bundle("AKIAOLD");
    const newValue = bundle("AKIANEW");
    let stored = oldValue;
    const operations: string[] = [];
    const write = vi.fn((_cfg, _id, value) => {
      operations.push(value === oldValue ? "write-old" : "write-new");
      stored = value;
    });
    const fetch = vi.fn(() => {
      operations.push("fetch");
      return new Map([[BOOTSTRAP_KEY, { id: PROVIDER_ID, value: stored }]]);
    });
    const verify = vi.fn(candidate => {
      operations.push(`verify-${candidate.bundle.accessKeyId}`);
    });

    const result = publishAwsBootstrap(newValue, {}, { fetch, write, verify });

    expect(result).toEqual({
      changed: true,
      profiles: ["agent-dev", "agent-production"],
    });
    expect(stored).toBe(newValue);
    expect(operations).toEqual([
      "fetch",
      "write-old",
      "verify-AKIANEW",
      "write-new",
      "fetch",
      "verify-AKIANEW",
    ]);
  });

  it("restores the previous value when provider read-back disagrees", () => {
    const oldValue = bundle("AKIAOLD");
    const newValue = bundle("AKIANEW");
    let stored = oldValue;
    let corruptNextRead = false;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
      if (value === newValue) corruptNextRead = true;
    });
    const fetch = vi.fn(() => {
      const value = corruptNextRead ? `${stored} ` : stored;
      corruptNextRead = false;
      return new Map([[BOOTSTRAP_KEY, { id: PROVIDER_ID, value }]]);
    });

    expect(() =>
      publishAwsBootstrap(newValue, {}, { fetch, write, verify: vi.fn() })
    ).toThrow("previous provider value was restored");
    expect(stored).toBe(oldValue);
  });

  it("never publishes a candidate whose STS verification fails", () => {
    const oldValue = bundle("AKIAOLD");
    let stored = oldValue;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
    });
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, { id: PROVIDER_ID, value: stored }]])
    );

    expect(() =>
      publishAwsBootstrap(
        bundle("AKIABAD"),
        {},
        {
          fetch,
          write,
          verify: vi.fn(() => {
            throw new Error("STS refused the candidate");
          }),
        }
      )
    ).toThrow("STS refused the candidate");

    // The only write was the no-op proof of the current provider value.
    expect(write).toHaveBeenCalledTimes(1);
    expect(stored).toBe(oldValue);
  });
});
