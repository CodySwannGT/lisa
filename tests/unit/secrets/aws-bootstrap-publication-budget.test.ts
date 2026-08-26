/**
 * Critical-section budget tests for AWS bootstrap publication.
 * @module tests/unit/secrets/aws-bootstrap-publication-budget
 */
import { describe, expect, it, vi } from "vitest";

import {
  preflightAwsBootstrap,
  publishAwsBootstrap,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/publish-aws-bootstrap.mjs";

const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";
const PROVIDER_ID = "provider-id";
const PROJECT_ID = "project-id";
const PUBLICATION_BUDGET_MS = 25 * 60 * 1000;

/**
 * Build one complete synthetic AWS bootstrap bundle.
 * @param accessKeyId Synthetic access-key id.
 * @returns Serialized bundle.
 */
function bundle(accessKeyId: string): string {
  return JSON.stringify({
    accessKeyId,
    secretAccessKey: `secret-for-${accessKeyId}`,
    externalId: "external-id",
    roleName: "RemoteAgent",
    profiles: JSON.stringify({
      "agent-dev": {
        roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
        region: "us-east-1",
      },
    }),
  });
}

/**
 * Wrap a value in the provider record shape used by publication.
 * @param value Serialized provider value.
 * @returns Synthetic provider record.
 */
function providerEntry(value: string) {
  return { id: PROVIDER_ID, projectId: PROJECT_ID, value };
}

/**
 * Provide successful injectable lock operations.
 * @returns Lock operation spies.
 */
function lockOperations() {
  return {
    acquireLock: vi.fn(() => ({
      id: "lock-id",
      key: "lock-key",
      targetId: PROVIDER_ID,
    })),
    releaseLock: vi.fn(),
  };
}

describe("AWS bootstrap publication budget", () => {
  it("refuses the candidate write when verification exhausts the budget", () => {
    const oldValue = bundle("AKIAOLD");
    const newValue = bundle("AKIANEW");
    let stored = oldValue;
    let now = 0;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
    });
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(stored)]])
    );
    const locks = lockOperations();

    expect(() =>
      publishAwsBootstrap(
        newValue,
        {},
        {
          fetch,
          write,
          verify: vi.fn(() => {
            now = PUBLICATION_BUDGET_MS;
          }),
          monotonicNow: vi.fn(() => now),
          ...locks,
        }
      )
    ).toThrow("publication lock execution budget exceeded");

    expect(stored).toBe(oldValue);
    expect(write).toHaveBeenCalledOnce();
    expect(locks.releaseLock).toHaveBeenCalledOnce();
  });

  it("refuses a stale rollback after post-write verification exhausts the budget", () => {
    const oldValue = bundle("AKIAOLD");
    const newValue = bundle("AKIANEW");
    let stored = oldValue;
    let now = 0;
    let verificationCount = 0;
    const write = vi.fn((_cfg, _id, value) => {
      stored = value;
    });
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(stored)]])
    );
    const locks = lockOperations();

    expect(() =>
      publishAwsBootstrap(
        newValue,
        {},
        {
          fetch,
          write,
          verify: vi.fn(() => {
            verificationCount += 1;
            if (verificationCount === 2) {
              now = PUBLICATION_BUDGET_MS;
              throw new Error("post-write verification stalled");
            }
          }),
          monotonicNow: vi.fn(() => now),
          ...locks,
        }
      )
    ).toThrow("rollback failed: publication lock execution budget exceeded");

    expect(stored).toBe(newValue);
    expect(write).toHaveBeenCalledTimes(2);
    expect(locks.releaseLock).toHaveBeenCalledOnce();
  });

  it("does no provider work when lock acquisition exhausts the budget", () => {
    const current = bundle("AKIAOLD");
    let now = 0;
    const fetch = vi.fn(
      () => new Map([[BOOTSTRAP_KEY, providerEntry(current)]])
    );
    const write = vi.fn();
    const locks = lockOperations();
    locks.acquireLock.mockImplementation(() => {
      now = PUBLICATION_BUDGET_MS;
      return { id: "lock-id", key: "lock-key", targetId: PROVIDER_ID };
    });

    expect(() =>
      preflightAwsBootstrap(
        {},
        {
          fetch,
          write,
          monotonicNow: vi.fn(() => now),
          ...locks,
        }
      )
    ).toThrow("publication lock execution budget exceeded");

    expect(fetch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect(locks.releaseLock).toHaveBeenCalledOnce();
  });
});
