/**
 * @file nightly-e2e-guard-certificate.test.ts
 * @description Behavior-certificate generation and tamper bites for the shipped guard
 * @module tests/unit/scripts/nightly-e2e-guard-certificate.test
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  certifyNightlyGuardPackageArtifact,
  generateNightlyGuardBehaviorCertificate,
} from "../../../scripts/generate-nightly-e2e-guard-certificate.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const GUARD = path.join(
  REPOSITORY_ROOT,
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
);
const INVOKED_AS_SCRIPT = path.join(
  REPOSITORY_ROOT,
  "typescript/copy-overwrite/scripts/lib/invoked-as-script.mjs"
);

/**
 * Certify one source against the real helper shipped beside the package artifact.
 * @param source - Candidate guard module bytes
 * @returns Verified digest-to-contract certificate entry
 */
async function certify(source: string) {
  return await certifyNightlyGuardPackageArtifact({
    guardBytes: Buffer.from(source),
    invokedAsScriptBytes: await readFile(INVOKED_AS_SCRIPT),
    packageVersion: "4.17.16",
    provenance: "workspace package @codyswann/lisa@4.17.16",
  });
}

describe("nightly guard behavior certificate generation", () => {
  it("certifies the real packaged handler only after exercising bounded waivers", async () => {
    const source = await readFile(GUARD, "utf8");
    const entry = await certify(source);
    expect(entry).toMatchObject({
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      contractVersion: "1.7.0",
      packageVersion: "4.17.16",
      provenance: expect.stringContaining("@codyswann/lisa@4.17.16"),
    });
  });

  it.each([
    [
      "declaration only",
      'export const NIGHTLY_E2E_CONTRACT_VERSION = "1.7.0";\n',
    ],
    [
      "comment only",
      '// export const NIGHTLY_E2E_CONTRACT_VERSION = "1.7.0";\n',
    ],
    [
      "forged always-valid handler",
      `
export const NIGHTLY_E2E_CONTRACT_VERSION = "1.7.0";
export const BYPASS_ABSOLUTE_MAX_HOURS = 72;
export function evaluateBypass() {
  return { valid: true, reason: "valid", actor: "maintainer", ticket: "#1", expiresAt: "2099-01-01T00:00:00.000Z" };
}
export function decide() {
  return { verdict: "bypassed", blocked: false, bypass: { waived: [{}] } };
}
`,
    ],
  ])("rejects a %s package artifact", async (_label, source) => {
    await expect(certify(source)).rejects.toThrow(
      /actual handler|bounded waiver|behavior certificate|contract/u
    );
  });

  it("generates the checked-in certificate from package and immutable release artifacts", async () => {
    const generated =
      await generateNightlyGuardBehaviorCertificate(REPOSITORY_ROOT);
    expect(generated.source).toContain(
      "NIGHTLY_E2E_GUARD_BEHAVIOR_CERTIFICATES"
    );
    expect(generated.certificates).toHaveLength(1);
    expect(generated.certificates[0]).toMatchObject({
      contractVersion: "1.7.0",
      packageVersions: expect.arrayContaining(["4.17.16"]),
      provenances: expect.arrayContaining([
        expect.stringContaining("v4.17.16"),
      ]),
    });
    await expect(
      readFile(
        path.join(
          REPOSITORY_ROOT,
          "src/core/nightly-e2e-guard-behavior-certificate.ts"
        ),
        "utf8"
      )
    ).resolves.toBe(generated.source);
  });
});
