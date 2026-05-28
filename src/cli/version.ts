import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const versionCache: { value?: string } = {};

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
