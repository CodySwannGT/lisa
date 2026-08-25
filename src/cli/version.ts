import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const versionCache: { value?: string } = {};
const releaseCommitCache: { value?: string | null } = {};

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
 * Read the immutable release commit stamped into the published package.
 * Source checkouts do not carry this field because their eventual merge
 * commit does not exist yet.
 *
 * @returns Forty-character release commit, or null in an unstamped checkout
 */
export function getPackageReleaseCommit(): string | null {
  if (releaseCommitCache.value !== undefined) {
    return releaseCommitCache.value;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findPackageJson(moduleDir);
  if (!packageJsonPath) {
    throw new Error("Unable to locate package.json for Lisa release commit");
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    lisaReleaseCommit?: unknown;
  };
  const releaseCommit = packageJson.lisaReleaseCommit;
  releaseCommitCache.value =
    typeof releaseCommit === "string" && /^[0-9a-f]{40}$/i.test(releaseCommit)
      ? releaseCommit.toLowerCase()
      : null;
  return releaseCommitCache.value;
}
