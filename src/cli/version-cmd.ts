import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type UpdateCheckResult, runUpdateCheck } from "./update-check.js";
import { getPackageVersion } from "./version.js";

/** Runtime collaborators for the version command. */
export interface VersionCommandDependencies {
  /** Resolve the installed Lisa package version. */
  getPackageVersion: typeof getPackageVersion;
  /** Run Lisa's non-fatal latest-version check. */
  runUpdateCheck: typeof runUpdateCheck;
  /** Write user-facing output. */
  write: (message: string) => void;
}

const DEFAULT_DEPENDENCIES: VersionCommandDependencies = {
  getPackageVersion,
  runUpdateCheck,
  write: message => console.log(message),
};

/**
 * Find the nearest package.json above the current module path.
 * @param startDir - Directory to start from
 * @returns Absolute package.json path or null
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
 * Resolve the installed package path for the running CLI.
 * @returns Absolute package root when discoverable
 */
export function getCliInstallPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJson = findPackageJson(moduleDir);
  return packageJson ? path.dirname(packageJson) : moduleDir;
}

/**
 * Resolve the configured default harness for the current project.
 * @param cwd - Project directory to inspect
 * @returns Harness string used by Lisa when no flag overrides it
 */
export async function readDefaultHarness(cwd = process.cwd()): Promise<string> {
  for (const fileName of [".lisa.config.local.json", ".lisa.config.json"]) {
    const configPath = path.join(cwd, fileName);
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
        harness?: unknown;
      };
      if (typeof parsed.harness === "string" && parsed.harness !== "") {
        return parsed.harness;
      }
    } catch {
      // Missing or malformed project config falls back to the CLI default.
    }
  }

  return "claude";
}

/**
 * Run `lisa version`.
 * @param dependencies - Optional collaborators for tests
 * @returns Promise that resolves after output is written
 */
export async function runVersion(
  dependencies: Partial<VersionCommandDependencies> = {}
): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const localVersion = deps.getPackageVersion();
  const updateResult: UpdateCheckResult = await deps.runUpdateCheck({
    currentVersion: localVersion,
  });
  const latestVersion = updateResult.latest ?? "unavailable";
  const harness = await readDefaultHarness();

  deps.write(
    [
      `local: ${localVersion}`,
      `latest: ${latestVersion}`,
      `installPath: ${getCliInstallPath()}`,
      `defaultHarness: ${harness}`,
    ].join("\n")
  );
}
