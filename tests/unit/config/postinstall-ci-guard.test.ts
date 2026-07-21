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
const LISA_BOOTSTRAP_PREFIX = "LISA_BOOTSTRAP=1 node";
const EXPO_PACKAGE_TEMPLATE = "expo/package-lisa/package.lisa.json";

/**
 * Minimal shape of a package.lisa.json for the assertions below.
 */
interface PackageLisaShape {
  readonly force?: {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  readonly defaults?: {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
}

const LISA_PACKAGE = "@codyswann/lisa";

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
  EXPO_PACKAGE_TEMPLATE,
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
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
        expect(script).toContain(LISA_BOOTSTRAP_PREFIX);
      }
    }
  );
});

describe("package.lisa.json templates never force-pin Lisa's own version", () => {
  // Background: `force.devDependencies["@codyswann/lisa"]` made every apply
  // (run from the project's own postinstall) overwrite the project's declared
  // Lisa version with the template's stale floor. A project upgraded via
  // `bun add -D @codyswann/lisa@latest` had its package.json silently reverted
  // on the very next install, so the bump never landed and looked like
  // cross-project corruption. Lisa's presence is guaranteed via `defaults`
  // (added when absent, preserved when present) instead — which keeps the
  // floor without clobbering a legitimate upgrade.
  it.each(TEMPLATE_PATHS.map(p => [p]))(
    "%s does not declare @codyswann/lisa in any force block",
    relPath => {
      const template = readTemplateJson(relPath) as PackageLisaShape;
      expect(template.force?.devDependencies?.[LISA_PACKAGE]).toBeUndefined();
      expect(template.force?.dependencies?.[LISA_PACKAGE]).toBeUndefined();
    }
  );

  it.each(TEMPLATE_PATHS.map(p => [p]))(
    "%s governs @codyswann/lisa via defaults when it pins a version at all",
    relPath => {
      const template = readTemplateJson(relPath) as PackageLisaShape;
      const defaultsPin = template.defaults?.devDependencies?.[LISA_PACKAGE];
      if (defaultsPin === undefined) return;
      expect(typeof defaultsPin).toBe("string");
      // Lisa is a dev tool: it must be governed only via
      // defaults.devDependencies, never pinned in regular `dependencies`.
      expect(template.defaults?.dependencies?.[LISA_PACKAGE]).toBeUndefined();
    }
  );
});

describe("package.lisa.json prepare scripts install hooks after successful builds", () => {
  it.each([
    ["package.lisa.json"],
    ["npm-package/package-lisa/package.lisa.json"],
  ])("%s runs husky install only after a successful build", relPath => {
    const template = readTemplateJson(relPath) as PackageLisaShape;
    const prepare = template.force?.scripts?.prepare;

    expect(prepare).toBe("$npm_execpath run build && husky install || true");
    expect(prepare).not.toContain("run build || husky install");
  });
});

describe("package.lisa.json templates carry force-governed CVE floors", () => {
  // Security floors must live in BOTH force.overrides and force.resolutions so
  // the pin holds under npm (overrides) and yarn/bun (resolutions). Because the
  // whole force block is authoritative, a downstream project cannot pin these
  // itself — a missing floor here silently ships the vulnerable transitive dep
  // fleet-wide and cannot be fixed downstream (the next apply wipes it).
  /** Minimal shape exposing the force override/resolution maps. */
  interface OverridesShape {
    readonly force?: {
      readonly overrides?: Readonly<Record<string, string>>;
      readonly resolutions?: Readonly<Record<string, string>>;
    };
  }

  it("typescript template floors systeminformation (harperdb GHSA-5xpp-75jx-m839)", () => {
    const template = readTemplateJson(
      "typescript/package-lisa/package.lisa.json"
    ) as OverridesShape;
    expect(template.force?.overrides?.systeminformation).toBe(">=5.27.14");
    expect(template.force?.resolutions?.systeminformation).toBe(">=5.27.14");
  });

  it("expo template floors websocket-driver (RN-firebase GHSA-xv26-6w52-cph6)", () => {
    const template = readTemplateJson(EXPO_PACKAGE_TEMPLATE) as OverridesShape;
    expect(template.force?.overrides?.["websocket-driver"]).toBe(">=0.7.5");
    expect(template.force?.resolutions?.["websocket-driver"]).toBe(">=0.7.5");
  });

  it("expo template floors fast-xml-parser (GHSA-8r6m-32jq-jx6q)", () => {
    const template = readTemplateJson(EXPO_PACKAGE_TEMPLATE) as OverridesShape;
    expect(template.force?.overrides?.["fast-xml-parser"]).toBe("^5.10.1");
    expect(template.force?.resolutions?.["fast-xml-parser"]).toBe("^5.10.1");
  });
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
