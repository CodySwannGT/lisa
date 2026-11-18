/**
 * A project's own advisory patch resolves a finding only while every proof
 * holds: the installed files match the patched content, the regression test
 * proves the fix (see audit-patch-proof.test.ts), and the registry has
 * published no fixed version. The registry is mocked; nothing here reaches
 * the network.
 */
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAuditReport,
  verifyCapturedAudit,
} from "../../../src/core/audit.js";
import { readAdvisoryPatches } from "../../../src/core/audit-patches.js";
import { installedCopies } from "../../../src/core/audit-installed-copies.js";
import {
  GHSA,
  PATCH_FILE,
  PATCHED,
  PRISTINE,
  TEST_FILE,
  UNPATCHED_ONLY,
  fixture,
  put,
  removeFixtures,
  report,
  sha256,
} from "../../helpers/audit-patch-fixture.js";

afterEach(removeFixtures);

describe("advisory patches in the audit gate", () => {
  it("accepts a finding when every proof holds", async () => {
    const verdict = await verifyCapturedAudit(fixture(), "bun", report(), {
      publishedVersions: UNPATCHED_ONLY,
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.messages.join("\n")).toContain(
      `patched ${GHSA} in glob@1.0.0 (${PATCH_FILE})`
    );
  });

  it("fails when the installed files do not match the patched content", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({ installed: PRISTINE }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `installed files do not match ${PATCH_FILE}`
    );
  });

  it("fails when the named regression test does not exist", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({ regressionTest: null }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `names regression test "${TEST_FILE}", which does not exist`
    );
  });

  it("fails as soon as the registry publishes a version outside the vulnerable range", async () => {
    const verdict = await verifyCapturedAudit(fixture(), "bun", report(), {
      publishedVersions: async () => ["1.0.0", "1.0.1", "2.0.0-rc.1"],
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `glob@1.0.1 is published outside the vulnerable range <=1.0.0; upgrade glob and delete ${PATCH_FILE}`
    );
  });

  it("ignores a prerelease or an older release outside the range", async () => {
    const verdict = await verifyCapturedAudit(
      fixture(),
      "bun",
      report(">=0.9.5 <=1.0.0"),
      { publishedVersions: async () => ["0.9.0", "1.0.0", "1.1.0-beta.0"] }
    );
    expect(verdict.passed).toBe(true);
  });

  it("fails closed when the registry cannot be asked", async () => {
    await expect(
      verifyCapturedAudit(fixture(), "bun", report(), {
        publishedVersions: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow(/cannot confirm that no fixed glob is published/u);
  });

  it("fails when a vulnerable copy has no patch naming the advisory", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({
        copies: { glob: ["glob@1.0.0"], "other/glob": ["glob@0.9.0"] },
      }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `glob@0.9.0 is vulnerable and no patch names ${GHSA} for it`
    );
  });

  it("fails when the patched copy is not installed", async () => {
    const root = fixture();
    rmSync(join(root, "node_modules"), { recursive: true });
    const verdict = await verifyCapturedAudit(root, "bun", report(), {
      publishedVersions: UNPATCHED_ONLY,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain("is not installed");
  });

  it("fails when the patch declares no hash to verify", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({
        header: [
          `Lisa-Advisory: ${GHSA}`,
          `Lisa-Regression-Test: ${TEST_FILE}`,
        ],
      }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      "declares no Lisa-Patched-File hash"
    );
  });

  it("leaves a finding no patch names to the exclusions", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({ header: [] }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.messages).toEqual([
      `${GHSA}: unresolved high/critical advisory for glob`,
    ]);
  });

  it("adds no hint for Bun, which applies the patch itself", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({ installed: PRISTINE }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.messages.join("\n")).not.toContain("gets no credit");
  });

  it("never credits a patch in the registry-free evaluator", () => {
    expect(evaluateAuditReport(fixture(), "bun", report()).passed).toBe(false);
  });

  it("derives the advisory mapping from the patch header alone", () => {
    expect(readAdvisoryPatches(fixture())).toEqual([
      {
        name: "glob",
        version: "1.0.0",
        file: PATCH_FILE,
        advisories: [GHSA],
        regressionTest: TEST_FILE,
        files: [{ path: "lib/index.js", sha256: sha256(PATCHED) }],
        problems: [],
      },
    ]);
  });

  it("finds real installed copies in hoisted and isolated layouts, skipping symlinks", () => {
    const root = fixture();
    put(
      root,
      "node_modules/parent/node_modules/glob/package.json",
      '{"name":"glob","version":"0.9.0"}'
    );
    symlinkSync(
      join(root, "node_modules/.bun/glob@1.0.0/node_modules/glob"),
      join(root, "node_modules/glob")
    );
    expect(
      installedCopies(root, "glob")
        .map(copy => copy.version)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(["0.9.0", "1.0.0"]);
  });
});
