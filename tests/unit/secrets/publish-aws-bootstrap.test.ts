/**
 * Fail-closed publication tests for remote AWS bootstrap rotations.
 * @module tests/unit/secrets/publish-aws-bootstrap
 */
import { describe, expect, it, vi } from "vitest";

import {
  preflightAwsBootstrap,
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
const PROJECT_ID = "project-id";

/**
 * A synthetic provider entry with the metadata coordination needs.
 * @param value Serialized bootstrap value.
 * @returns Synthetic provider entry.
 */
const providerEntry = (value: string) => ({
  id: PROVIDER_ID,
  projectId: PROJECT_ID,
  value,
});

/**
 * Inject a successful lock so publication tests can focus on transaction order.
 * @param operations Ordered event sink.
 * @returns Injectable lock operations.
 */
function lockOperations(operations: string[] = []) {
  const lock = { id: "lock-id", key: "lock-key", targetId: PROVIDER_ID };
  return {
    acquireLock: vi.fn(() => {
      operations.push("lock");
      return lock;
    }),
    releaseLock: vi.fn(() => {
      operations.push("unlock");
    }),
  };
}

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
      expect(environment.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS).toBe("true");
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
  it("holds the provider lock around the preflight write", () => {
    const current = bundle("AKIAOLD");
    const operations: string[] = [];
    const locks = lockOperations(operations);
    const fetch = vi.fn(() => {
      operations.push("fetch");
      return new Map([[BOOTSTRAP_KEY, providerEntry(current)]]);
    });
    const write = vi.fn(() => operations.push("write"));

    preflightAwsBootstrap(
      { provider: "bitwarden" },
      { fetch, write, ...locks }
    );

    expect(operations).toEqual(["fetch", "lock", "fetch", "write", "unlock"]);
  });

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
      return new Map([[BOOTSTRAP_KEY, providerEntry(stored)]]);
    });
    const verify = vi.fn(candidate => {
      operations.push(`verify-${candidate.bundle.accessKeyId}`);
    });

    const locks = lockOperations(operations);
    const result = publishAwsBootstrap(
      newValue,
      {},
      {
        fetch,
        write,
        verify,
        ...locks,
      }
    );

    expect(result).toEqual({
      changed: true,
      profiles: ["agent-dev", "agent-production"],
    });
    expect(stored).toBe(newValue);
    expect(operations).toEqual([
      "fetch",
      "lock",
      "fetch",
      "write-old",
      "verify-AKIANEW",
      "write-new",
      "fetch",
      "verify-AKIANEW",
      "unlock",
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
      return new Map([[BOOTSTRAP_KEY, providerEntry(value)]]);
    });
    const locks = lockOperations();

    expect(() =>
      publishAwsBootstrap(
        newValue,
        {},
        {
          fetch,
          write,
          verify: vi.fn(),
          ...locks,
        }
      )
    ).toThrow("previous provider value was restored");
    expect(stored).toBe(oldValue);
    expect(locks.releaseLock).toHaveBeenCalledOnce();
  });

  it("never publishes a candidate whose STS verification fails", () => {
    const oldValue = bundle("AKIAOLD");
    let stored = oldValue;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
    });
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(stored)]])
    );
    const locks = lockOperations();

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
          ...locks,
        }
      )
    ).toThrow("STS refused the candidate");

    // The only write was the no-op proof of the current provider value.
    expect(write).toHaveBeenCalledTimes(1);
    expect(stored).toBe(oldValue);
  });

  it("does not roll an overlapping publication back to a stale value", () => {
    const oldValue = bundle("AKIAOLD");
    const candidateValue = bundle("AKIACANDIDATE");
    const newerValue = bundle("AKIANEWER");
    let stored = oldValue;
    let verificationCount = 0;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
    });
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(stored)]])
    );
    const verify = vi.fn(() => {
      verificationCount += 1;
      if (verificationCount === 2) {
        stored = newerValue;
        throw new Error("post-write verification failed");
      }
    });

    const locks = lockOperations();
    expect(() =>
      publishAwsBootstrap(
        candidateValue,
        {},
        {
          fetch,
          write,
          verify,
          ...locks,
        }
      )
    ).toThrow(
      "rollback skipped because the provider changed after this publication"
    );
    expect(stored).toBe(newerValue);
    expect(write).toHaveBeenCalledTimes(2);
    expect(locks.releaseLock).toHaveBeenCalledOnce();
  });

  it("fails closed when the provider lock cannot be released", () => {
    const current = bundle("AKIAOLD");
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(current)]])
    );

    expect(() =>
      publishAwsBootstrap(
        current,
        {},
        {
          fetch,
          write: vi.fn(),
          verify: vi.fn(),
          acquireLock: vi.fn(() => ({
            id: "lock-id",
            key: "lock-key",
            targetId: PROVIDER_ID,
          })),
          releaseLock: vi.fn(() => {
            throw new Error("provider refused lock deletion");
          }),
        }
      )
    ).toThrow(
      "publication completed; publication lock release failed: provider refused lock deletion; " +
        "remove the coordination record before the next publication"
    );
  });
});
