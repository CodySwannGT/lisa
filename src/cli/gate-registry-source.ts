/**
 * Locate and import the gate registry that ships inside the running Lisa
 * package.
 *
 * Deliberately Lisa's own copy rather than the project's
 * `scripts/lisa-gates.mjs`. Both are the same file in a healthy repository — it
 * installs by copy-overwrite — but a stale project copy would answer with a
 * table describing a workflow that is no longer there. The authority is the
 * version of Lisa doing the reporting.
 *
 * Extracted so every doctor check that consults the registry resolves it the
 * same way. Two copies of this walk would be two answers to "where is the
 * registry", and the one that went stale would be the one nobody measured.
 * @module cli/gate-registry-source
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The registry's path relative to the Lisa package root. */
const REGISTRY_RELATIVE_PATH = path.join(
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/**
 * Walk parents until a package-root-relative file exists.
 * @param startDir - Directory to start searching from
 * @param relativePath - Path under the package root
 * @returns Absolute path, or null when no ancestor holds it
 */
function findPackageFileWalk(
  startDir: string,
  relativePath: string
): string | null {
  const candidate = path.join(startDir, relativePath);
  if (existsSync(candidate)) return candidate;
  const parent = path.dirname(startDir);
  return parent === startDir ? null : findPackageFileWalk(parent, relativePath);
}

/**
 * Locate the shipped gate registry inside the running Lisa package.
 * @returns Absolute path to the registry, or null when it cannot be found
 */
export function resolveGateRegistryPath(): string | null {
  const fromPackageRoot = path.join(
    __dirname,
    "..",
    "..",
    REGISTRY_RELATIVE_PATH
  );
  if (existsSync(fromPackageRoot)) return fromPackageRoot;
  return findPackageFileWalk(__dirname, REGISTRY_RELATIVE_PATH);
}

/**
 * Import the shipped registry.
 * @returns The registry module, or null when it is not installed
 */
export async function importGateRegistry<T>(): Promise<T | null> {
  const script = resolveGateRegistryPath();
  if (script === null) return null;
  return (await import(pathToFileURL(script).href)) as unknown as T;
}
