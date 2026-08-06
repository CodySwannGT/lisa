import fs from "node:fs";
import path from "node:path";
import { gte, major } from "semver";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/**
 * Advisories against js-yaml this floor answers, newest first.
 *
 * Kept as a list rather than replaced: an exclusion added for the older one is
 * just as capable of hiding the newer, since both are the same package under
 * the same audit gate.
 *
 * - `GHSA-5p4m-2wfm-xmqj` — quadratic CPU in `!!omap` resolution, patched in
 *   3.15.1 and 4.3.1 (the 4.x fix was not backported to the earlier 3.x floor).
 * - `GHSA-52cp-r559-cp3m` — the advisory this file was first written for.
 */
const ADVISORY_IDS = ["GHSA-5p4m-2wfm-xmqj", "GHSA-52cp-r559-cp3m"] as const;
/** The repository's own manifest, which several floors read separately. */
const ROOT_MANIFEST = "package.json";
const DIRECT_MANIFESTS = [
  ROOT_MANIFEST,
  "plugins/src/expo/skills/expo-cicd-workflows/scripts/package.json",
] as const;
const AUDIT_IGNORE_FILES = [
  "audit.ignore.config.json",
  "audit.ignore.local.json",
] as const;
const LOCK_VERSION_MARKER = '["js-yaml@';

/** Dependency sections relevant to the js-yaml security contract. */
interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, string>>;
  readonly resolutions?: Readonly<Record<string, string>>;
}

/** Shape of both audit exclusion files consumed by the pre-push hook. */
interface AuditIgnoreConfig {
  readonly exclusions: readonly { readonly id: string }[];
}

/**
 * Read a repository JSON file.
 * @param relativePath - Path relative to the repository root
 * @returns Parsed JSON with the requested shape
 */
function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
  ) as T;
}

describe("js-yaml security floors", () => {
  it.each(DIRECT_MANIFESTS)(
    "keeps %s on the patched 4.x line",
    manifestPath => {
      const manifest = readJson<PackageManifest>(manifestPath);
      const range =
        manifest.dependencies?.["js-yaml"] ??
        manifest.devDependencies?.["js-yaml"];

      expect(range).toBe("^4.3.1");
    }
  );

  it("resolves every locked 3.x and 4.x copy above its advisory floor", () => {
    const lockfile = fs.readFileSync(path.join(REPO_ROOT, "bun.lock"), "utf8");
    const versions = lockfile
      .split("\n")
      .filter(line => line.includes(LOCK_VERSION_MARKER))
      .map(line => {
        const start =
          line.indexOf(LOCK_VERSION_MARKER) + LOCK_VERSION_MARKER.length;
        return line.slice(start, line.indexOf('"', start));
      });

    expect(new Set(versions.map(version => major(version)))).toEqual(
      new Set([3, 4])
    );
    for (const version of versions) {
      expect(gte(version, major(version) === 3 ? "3.15.1" : "4.3.1")).toBe(
        true
      );
    }
  });

  it.each(AUDIT_IGNORE_FILES)(
    "does not suppress the advisories in %s",
    file => {
      const auditIgnores = readJson<AuditIgnoreConfig>(file);
      const excluded = auditIgnores.exclusions.map(exclusion => exclusion.id);

      for (const advisory of ADVISORY_IDS) {
        expect(excluded).not.toContain(advisory);
      }
    }
  );

  it("does not force js-yaml across major lines", () => {
    // A blanket override drags `@istanbuljs/load-nyc-config` from 3.x to 4.x,
    // where the `safeLoad` it calls no longer exists. Verified: adding one
    // collapses the nested copy and removing it restores 3.15.1.
    const rootManifest = readJson<PackageManifest>(ROOT_MANIFEST);

    expect(rootManifest.overrides?.["js-yaml"]).toBeUndefined();
    expect(rootManifest.resolutions?.["js-yaml"]).toBeUndefined();
  });

  it("patches the 3.x line where it is actually consumed", () => {
    // The 4.x floor cannot reach it: the only 3.x copy arrives transitively,
    // so a path-scoped override is what raises it without a major bump.
    const rootManifest = readJson<
      PackageManifest & {
        readonly overrides?: Readonly<
          Record<string, Readonly<Record<string, string>>>
        >;
      }
    >(ROOT_MANIFEST);

    expect(rootManifest.overrides?.["@istanbuljs/load-nyc-config"]).toEqual({
      "js-yaml": "^3.15.1",
    });
  });
});
