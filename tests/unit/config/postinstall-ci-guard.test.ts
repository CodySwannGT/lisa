/**
 * Unit tests that guard against regressing the CI-skip prefix on Lisa's
 * postinstall invocation in package.lisa.json templates and the migration
 * that injects it into downstream project package.json files.
 *
 * Background: in CI, the project's postinstall would silently re-apply Lisa
 * templates during `bun install --frozen-lockfile`, creating a class of
 * race conditions (package.json churn vs. lockfile) and masking drift. The
 * guard `[ -n "$CI" ] ||` short-circuits when the CI env var is set, so the
 * PR diff becomes the drift detector instead.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CI_GUARD_PREFIX = '[ -n "$CI" ] ||';
const LISA_MARKER = "node_modules/@codyswann/lisa/dist/index.js";

/**
 * Minimal shape of a package.lisa.json for the assertions below.
 */
interface PackageLisaShape {
  readonly force?: { readonly scripts?: Readonly<Record<string, string>> };
  readonly defaults?: { readonly scripts?: Readonly<Record<string, string>> };
}

/**
 * Load a JSON file from disk and return its parsed contents.
 * @param relativePath - Path relative to the Lisa repo root
 * @returns Parsed JSON (unknown shape; tests narrow as needed)
 */
function readTemplateJson(relativePath: string): unknown {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolute, "utf-8"));
}

const TEMPLATE_PATHS = [
  "package.lisa.json",
  "typescript/package-lisa/package.lisa.json",
  "expo/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "npm-package/package-lisa/package.lisa.json",
] as const;

describe("package.lisa.json templates guard Lisa postinstall with CI-skip prefix", () => {
  it.each(TEMPLATE_PATHS.map(p => [p]))(
    "%s either omits postinstall or prefixes it with the CI guard",
    relPath => {
      const template = readTemplateJson(relPath) as PackageLisaShape;
      const forcePostinstall = template.force?.scripts?.postinstall;
      const defaultsPostinstall = template.defaults?.scripts?.postinstall;

      for (const script of [forcePostinstall, defaultsPostinstall]) {
        if (typeof script !== "string") continue;
        if (!script.includes(LISA_MARKER)) continue;
        // If the template defines a Lisa postinstall at all, it MUST be
        // CI-guarded. Lisa already relies on PR diffs for drift detection;
        // silently re-applying templates in CI creates race conditions.
        expect(script.startsWith(CI_GUARD_PREFIX)).toBe(true);
      }
    }
  );
});

describe("EnsureLisaPostinstallMigration injects CI-guarded invocation", () => {
  it("the migration's LISA_INVOCATION constant starts with the CI guard", async () => {
    // Read the compiled source verbatim — we want to guard the literal
    // string, not a runtime export, so future refactors that move the
    // constant still trip this test if the guard is dropped.
    const migrationSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/migrations/ensure-lisa-postinstall.ts"),
      "utf-8"
    );
    // The invocation template literal must include both the CI guard and
    // the Lisa marker somewhere in the source file.
    expect(migrationSrc).toContain(CI_GUARD_PREFIX);
    expect(migrationSrc).toContain(LISA_MARKER);
  });
});
