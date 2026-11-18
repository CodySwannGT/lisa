/**
 * A project's own advisory patch resolves a finding only while every proof
 * holds: the installed files match the patched content, the patch names a
 * regression test that exists, and the registry has published no fixed
 * version. The registry is mocked; nothing here reaches the network.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAuditReport,
  verifyCapturedAudit,
} from "../../../src/core/audit.js";
import {
  installedCopies,
  readAdvisoryPatches,
} from "../../../src/core/audit-patches.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const PATCHED = "module.exports = 'patched';\n";
const PRISTINE = "module.exports = 'pristine';\n";
const PATCH_FILE = ".lisa/patches/glob@1.0.0.patch";
const TEST_FILE = ".lisa/patches/glob.regression.mjs";
/**
 * A registry that has published only vulnerable versions.
 * @returns Published versions
 */
const UNPATCHED_ONLY = async () => ["0.9.0", "1.0.0"];
const roots: string[] = [];

/**
 * A Bun report with one high advisory for glob.
 * @param range - The advisory's vulnerable range
 * @returns Report JSON
 */
const report = (range = "<=1.0.0") =>
  JSON.stringify({
    glob: [
      {
        id: 1,
        severity: "high",
        url: `https://github.com/advisories/${GHSA}`,
        vulnerable_versions: range,
      },
    ],
  });

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/**
 * Write a file, creating its directory.
 * @param root - Fixture root
 * @param file - Path relative to the root
 * @param text - File content
 */
function put(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/**
 * A Bun project whose glob@1.0.0 is patched by a header-carrying patch.
 * @param overrides - Fixture variations
 * @param overrides.installed - Content of the installed lib/index.js
 * @param overrides.header - Header lines above the diff
 * @param overrides.regressionTest - Whether the regression test file exists
 * @param overrides.copies - Lockfile packages map
 * @returns Fixture root
 */
function fixture({
  installed = PATCHED,
  header = [
    `Lisa-Advisory: ${GHSA}`,
    `Lisa-Regression-Test: ${TEST_FILE}`,
    `Lisa-Patched-File: lib/index.js sha256:${sha256(PATCHED)}`,
  ],
  regressionTest = true,
  copies = { glob: ["glob@1.0.0"] } as Record<string, unknown>,
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-patches-"));
  const store = "node_modules/.bun/glob@1.0.0/node_modules/glob";
  roots.push(root);
  put(
    root,
    "package.json",
    JSON.stringify({
      name: "host",
      patchedDependencies: { "glob@1.0.0": PATCH_FILE },
    })
  );
  put(
    root,
    "bun.lock",
    `// JSONC fixture\n${JSON.stringify({ packages: copies })}`
  );
  put(
    root,
    PATCH_FILE,
    `${header.join("\n")}\n\ndiff --git a/lib/index.js b/lib/index.js\n`
  );
  if (regressionTest) put(root, TEST_FILE, "// proof\n");
  put(root, `${store}/package.json`, '{"name":"glob","version":"1.0.0"}');
  put(root, `${store}/lib/index.js`, installed);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

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
      fixture({ regressionTest: false }),
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

  it("names the fix when npm cannot apply a patch Lisa ships", async () => {
    const root = fixture({ installed: PRISTINE });
    // npm reads no patchedDependencies, so nothing declares the patch.
    put(root, "package.json", JSON.stringify({ name: "host" }));
    put(
      root,
      "package-lock.json",
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "host" },
          "node_modules/glob": { version: "1.0.0" },
        },
      })
    );
    const npmReport = JSON.stringify({
      vulnerabilities: {
        glob: {
          severity: "high",
          via: [
            {
              source: 1,
              url: `https://github.com/advisories/${GHSA}`,
              severity: "high",
              range: "<=1.0.0",
            },
          ],
        },
      },
    });
    const verdict = await verifyCapturedAudit(root, "npm", npmReport, {
      publishedVersions: UNPATCHED_ONLY,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `Lisa ships a verified patch for glob (${PATCH_FILE}), but npm has no native patch mechanism`
    );
    expect(verdict.messages.join("\n")).toContain("switch this project to Bun");
  });

  it("adds no hint for Bun, which applies the patch itself", async () => {
    const verdict = await verifyCapturedAudit(
      fixture({ installed: PRISTINE }),
      "bun",
      report(),
      { publishedVersions: UNPATCHED_ONLY }
    );
    expect(verdict.messages.join("\n")).not.toContain("native patch mechanism");
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
