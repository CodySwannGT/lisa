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
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const GUARD = path.join(
  REPOSITORY_ROOT,
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
);
const INVOKED_AS_SCRIPT = path.join(
  REPOSITORY_ROOT,
  "typescript/copy-overwrite/scripts/lib/invoked-as-script.mjs"
);
const RETAINED_GUARD_DIGEST =
  "1c79ec49e5f4a3bba700bc1d97e9fc0f4f1799dec3acdf2bed5e3e5b866a0efd";

/**
 * Read the package version that the generator certifies as its workspace input.
 * @returns Current workspace package version
 */
async function readWorkspacePackageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8")
  ) as { version: string };
  return packageJson.version;
}

/**
 * Certify one source against the real helper shipped beside the package artifact.
 * @param source - Candidate guard module bytes
 * @returns Verified digest-to-contract certificate entry
 */
async function certify(source: string) {
  const packageVersion = await readWorkspacePackageVersion();
  return await certifyNightlyGuardPackageArtifact({
    guardBytes: Buffer.from(source),
    invokedAsScriptBytes: await readFile(INVOKED_AS_SCRIPT),
    packageVersion,
    provenance: `workspace package @codyswann/lisa@${packageVersion}`,
  });
}

describe("nightly guard behavior certificate generation", () => {
  it("certifies the real packaged handler only after exercising bounded waivers", async () => {
    const source = await readFile(GUARD, "utf8");
    const packageVersion = await readWorkspacePackageVersion();
    const entry = await certify(source);
    expect(entry).toMatchObject({
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      contractVersion: "1.9.0",
      packageVersion,
      provenance: expect.stringContaining(`@codyswann/lisa@${packageVersion}`),
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
    const packageVersion = await readWorkspacePackageVersion();
    const generated =
      await generateNightlyGuardBehaviorCertificate(REPOSITORY_ROOT);
    expect(generated.source).toContain(
      "NIGHTLY_E2E_GUARD_BEHAVIOR_CERTIFICATES"
    );
    // The current handler has a new digest after the not-measured state fix;
    // the three retained historical handlers remain certified independently.
    expect(generated.certificates).toHaveLength(4);
    expect(generated.certificates).toContainEqual(
      expect.objectContaining({
        digest: RETAINED_GUARD_DIGEST,
        contractVersion: "1.1.0",
        packageVersions: expect.arrayContaining(["2.352.0"]),
        provenances: expect.arrayContaining([
          expect.stringContaining("v2.353.0"),
        ]),
      })
    );
    expect(generated.certificates).toContainEqual(
      expect.objectContaining({
        contractVersion: "1.9.0",
        packageVersions: expect.arrayContaining([packageVersion]),
        provenances: expect.arrayContaining([
          expect.stringContaining(
            `workspace package @codyswann/lisa@${packageVersion}`
          ),
        ]),
      })
    );
    expect(generated.certificates).toContainEqual(
      expect.objectContaining({
        contractVersion: "1.7.0",
        packageVersions: expect.arrayContaining(["4.17.15"]),
        provenances: expect.arrayContaining([
          expect.stringContaining("v4.17.16"),
        ]),
      })
    );
    // 1.8.0 shipped as `@codyswann/lisa@4.26.1` and is STILL installed in the
    // field. Regeneration certifies the workspace bytes under the workspace
    // package version, so moving the guard to 1.9.0 without retaining v4.26.1
    // would revoke the certificate for a release already in use — the proof
    // path would refuse to execute bytes it trusted the day before. The same
    // package version therefore legitimately carries two digests.
    expect(generated.certificates).toContainEqual(
      expect.objectContaining({
        contractVersion: "1.8.0",
        packageVersions: expect.arrayContaining([packageVersion]),
        provenances: expect.arrayContaining([
          expect.stringContaining("v4.26.1"),
        ]),
      })
    );
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

  it("applies the retained v2 handler's self-bypass refusal expectation", async () => {
    const guardBytes = Buffer.from(
      boundedExecFileSync({
        label: "read retained v2 nightly guard artifact",
        command: "/usr/bin/git",
        args: [
          "show",
          "v2.353.0:typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs",
        ],
        cwd: REPOSITORY_ROOT,
      })
    );
    const entry = await certifyNightlyGuardPackageArtifact({
      guardBytes,
      packageVersion: "2.352.0",
      provenance: "git tag v2.353.0 package @codyswann/lisa@2.352.0",
    });

    expect(entry).toMatchObject({
      digest: RETAINED_GUARD_DIGEST,
      contractVersion: "1.1.0",
    });
  });
});
