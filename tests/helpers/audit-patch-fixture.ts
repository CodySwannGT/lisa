/**
 * A Bun project fixture with one advisory patch for glob@1.0.0, for the audit
 * patch tests. Each fixture lives in its own temp directory until
 * removeFixtures runs.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verifyCapturedAudit } from "../../src/core/audit.js";

export const GHSA = "GHSA-aaaa-bbbb-cccc";
export const PATCHED = "module.exports = 'patched';\n";
export const PRISTINE = "module.exports = 'pristine';\n";
export const PATCH_FILE = ".lisa/patches/glob@1.0.0.patch";
export const TEST_FILE = ".lisa/patches/glob.regression.mjs";
export const DIFF = [
  "diff --git a/lib/index.js b/lib/index.js",
  "--- a/lib/index.js",
  "+++ b/lib/index.js",
  "@@ -1 +1 @@",
  `-${PRISTINE.trim()}`,
  `+${PATCHED.trim()}`,
  "",
].join("\n");
export const README_DIFF = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1 @@",
  "-# glob",
  "+# glob, patched",
  "",
].join("\n");
/** Passes only when every given copy's lib/index.js is the patched one. */
export const PROOF = [
  'import { createRequire } from "node:module";',
  'import { join, resolve } from "node:path";',
  "const load = createRequire(import.meta.url);",
  "const dirs = process.argv.slice(2);",
  'const fixed = dirs.every(dir => load(join(resolve(dir), "lib/index.js")) === "patched");',
  "process.exitCode = dirs.length && fixed ? 0 : 1;",
  "",
].join("\n");
/** Regression tests that prove nothing: one passes always, one never. */
export const EMPTY_TEST = "\n";
export const FAILING_TEST = "process.exitCode = 1;\n";
/**
 * A registry that has published only vulnerable versions.
 * @returns Published versions
 */
async function unpatchedOnly(): Promise<readonly string[]> {
  return ["0.9.0", "1.0.0"];
}
export const UNPATCHED_ONLY = unpatchedOnly;

/** Every fixture lives under this directory until removeFixtures runs. */
const FIXTURES = join(tmpdir(), `lisa-audit-patches-${process.pid}`);

/**
 * A Bun report with one high advisory for glob.
 * @param range - The advisory's vulnerable range
 * @returns Report JSON
 */
export const report = (range = "<=1.0.0") =>
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

export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/**
 * Write a file, creating its directory.
 * @param root - Fixture root
 * @param file - Path relative to the root
 * @param text - File content
 */
export function put(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/**
 * A Bun project whose glob@1.0.0 is patched by a header-carrying patch.
 * @param overrides - Fixture variations
 * @param overrides.installed - Content of the installed lib/index.js
 * @param overrides.header - Header lines above the diff
 * @param overrides.regressionTest - Regression test source, or null for none
 * @param overrides.copies - Lockfile packages map
 * @param overrides.diff - The diff below the header
 * @param overrides.spec - The patchedDependencies key
 * @returns Fixture root
 */
export function fixture({
  installed = PATCHED,
  header = [
    `Lisa-Advisory: ${GHSA}`,
    `Lisa-Regression-Test: ${TEST_FILE}`,
    `Lisa-Patched-File: lib/index.js sha256:${sha256(PATCHED)}`,
  ],
  regressionTest = PROOF as string | null,
  copies = { glob: ["glob@1.0.0"] } as Record<string, unknown>,
  diff = DIFF,
  spec = "glob@1.0.0",
} = {}): string {
  const store = "node_modules/.bun/glob@1.0.0/node_modules/glob";
  const root = mkdtempSync(
    join(mkdirSync(FIXTURES, { recursive: true }) ?? FIXTURES, "fixture-")
  );
  put(
    root,
    "package.json",
    JSON.stringify({
      name: "host",
      patchedDependencies: { [spec]: PATCH_FILE },
    })
  );
  put(
    root,
    "bun.lock",
    `// JSONC fixture\n${JSON.stringify({ packages: copies })}`
  );
  put(root, PATCH_FILE, `${header.join("\n")}\n\n${diff}`);
  if (regressionTest !== null) put(root, TEST_FILE, regressionTest);
  put(root, `${store}/package.json`, '{"name":"glob","version":"1.0.0"}');
  put(root, `${store}/lib/index.js`, installed);
  put(root, `${store}/README.md`, "# glob, patched\n");
  return root;
}

/** Remove every fixture made so far. */
export function removeFixtures(): void {
  rmSync(FIXTURES, { recursive: true, force: true });
}

/**
 * Audit a fixture against the default report with an unpatched registry.
 * @param root - Fixture root
 * @param range - The advisory's vulnerable range
 * @returns The joined verdict messages and whether it passed
 */
export async function auditFixture(root: string, range?: string) {
  const verdict = await verifyCapturedAudit(root, "bun", report(range), {
    publishedVersions: UNPATCHED_ONLY,
  });
  return { passed: verdict.passed, text: verdict.messages.join("\n") };
}
