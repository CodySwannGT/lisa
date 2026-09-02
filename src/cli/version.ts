import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const versionCache: { value?: string } = {};
const releaseTagCache: { value?: string | null } = {};

/**
 * Find the nearest package.json by walking from a compiled/source module path.
 * @param startDir - Directory to start searching from
 * @returns Absolute package.json path, or null when no package file exists above
 */
function findPackageJson(startDir: string): string | null {
  const candidate = path.join(startDir, "package.json");
  if (existsSync(candidate)) {
    return candidate;
  }

  const parent = path.dirname(startDir);
  return parent === startDir ? null : findPackageJson(parent);
}

/**
 * Read Lisa's package version from package.json and cache it for this process.
 * @returns Package version string
 */
export function getPackageVersion(): string {
  if (versionCache.value) {
    return versionCache.value;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findPackageJson(moduleDir);
  if (!packageJsonPath) {
    throw new Error("Unable to locate package.json for Lisa CLI version");
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    throw new Error("package.json is missing a string version field");
  }

  versionCache.value = packageJson.version;
  return versionCache.value;
}

/**
 * Read the release tag stamped into the published package.
 *
 * The published package records the tag the release was cut at, not the commit
 * it was built from. A commit is not durable: a history rewrite leaves the old
 * object present but reachable from no ref, and a workflow pinned at such a
 * SHA does not fail — it never loads, so the consumer sees zero jobs, zero
 * failures, and a run history indistinguishable from a healthy one. A tag ref
 * is what the release process actually guarantees and is carried forward by a
 * rewrite, so it is the only identity safe to hand a consumer.
 *
 * Source checkouts do not carry this field because their release tag does not
 * exist yet.
 * @returns Stamped release tag, or null in an unstamped checkout
 */
export function getPackageReleaseTag(): string | null {
  if (releaseTagCache.value !== undefined) {
    return releaseTagCache.value;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findPackageJson(moduleDir);
  if (!packageJsonPath) {
    throw new Error("Unable to locate package.json for Lisa release tag");
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    lisaReleaseTag?: unknown;
  };
  const releaseTag = packageJson.lisaReleaseTag;
  releaseTagCache.value =
    typeof releaseTag === "string" && releaseTag.trim() !== ""
      ? releaseTag.trim()
      : null;
  return releaseTagCache.value;
}
