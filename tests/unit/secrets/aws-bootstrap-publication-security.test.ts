/**
 * Secret-safe failure behavior for AWS bootstrap publication.
 * @module tests/unit/secrets/aws-bootstrap-publication-security
 */
import { expect, it, vi } from "vitest";

import { preflightAwsBootstrap } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/publish-aws-bootstrap.mjs";

const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";
const SENSITIVE_VALUE = "sensitive-provider-value";

it("never includes a provider-write credential in an error", () => {
  const fetch = vi.fn(
    () =>
      new Map([
        [
          BOOTSTRAP_KEY,
          {
            id: "provider-id",
            projectId: "project-id",
            value: SENSITIVE_VALUE,
          },
        ],
      ])
  );
  let failure: unknown;

  try {
    preflightAwsBootstrap(
      { provider: "bitwarden" },
      {
        fetch,
        write: vi.fn((_cfg: object, _id: string, value: string) => {
          throw new Error(`Command failed with credential ${value}`);
        }),
        acquireLock: vi.fn(() => ({ id: "lock-id" })),
        releaseLock: vi.fn(),
      }
    );
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("provider write command failed");
  expect(String(failure)).not.toContain(SENSITIVE_VALUE);
});
