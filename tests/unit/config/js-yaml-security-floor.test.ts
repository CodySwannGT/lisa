import fs from "node:fs";
import path from "node:path";
import { gte, major } from "semver";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ADVISORY_ID = "GHSA-52cp-r559-cp3m";
const DIRECT_MANIFESTS = [
  "package.json",
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

      expect(range).toBe("^4.3.0");
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
      expect(gte(version, major(version) === 3 ? "3.15.0" : "4.3.0")).toBe(
        true
      );
    }
  });

  it.each(AUDIT_IGNORE_FILES)("does not suppress the advisory in %s", file => {
    const auditIgnores = readJson<AuditIgnoreConfig>(file);

    expect(
      auditIgnores.exclusions.map(exclusion => exclusion.id)
    ).not.toContain(ADVISORY_ID);
  });

  it("does not force js-yaml across major lines", () => {
    const rootManifest = readJson<PackageManifest>("package.json");

    expect(rootManifest.overrides?.["js-yaml"]).toBeUndefined();
    expect(rootManifest.resolutions?.["js-yaml"]).toBeUndefined();
  });
});
