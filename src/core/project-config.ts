/**
 * Per-project Lisa configuration persisted in `.lisa.config.json` at the
 * destination project root. Tracks settings that need to survive across
 * `lisa` invocations — e.g. which harness(es) the project targets.
 *
 * The file is intended to be checked into the host project's git history,
 * since the harness choice is part of the project's contract with Lisa.
 * @module project-config
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_HARNESS, HARNESS_VALUES, type Harness } from "./config.js";

/** Filename of the per-project config, relative to the destination root */
export const PROJECT_CONFIG_FILENAME = ".lisa.config.json";

/**
 * Schema of `.lisa.config.json`. Additional fields may be added in future
 * versions; unknown fields are preserved on round-trip.
 */
export interface ProjectConfig {
  /** Target harness(es) for emitted artifacts */
  readonly harness?: Harness;
}

/**
 * Read `.lisa.config.json` from a destination project, returning {} if absent.
 *
 * Throws if the file exists but is invalid JSON or contains an invalid harness
 * value, since silently ignoring a malformed config would mask user mistakes.
 * @param destDir - Absolute path to the destination project root
 * @returns Parsed project config (empty object if file is absent)
 */
export async function readProjectConfig(
  destDir: string
): Promise<ProjectConfig> {
  const configPath = path.join(destDir, PROJECT_CONFIG_FILENAME);
  if (!(await fse.pathExists(configPath))) {
    return {};
  }
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateProjectConfig(parsed, configPath);
}

/**
 * Write `.lisa.config.json` to a destination project, merging into any
 * existing content so unknown fields written by future Lisa versions are
 * preserved on round-trip.
 * @param destDir - Absolute path to the destination project root
 * @param updates - Partial config to merge into the existing file
 */
export async function writeProjectConfig(
  destDir: string,
  updates: ProjectConfig
): Promise<void> {
  const configPath = path.join(destDir, PROJECT_CONFIG_FILENAME);
  const existing = (await fse.pathExists(configPath))
    ? ((JSON.parse(await readFile(configPath, "utf8")) as unknown) ?? {})
    : {};
  const merged = { ...(existing as object), ...updates };
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

/**
 * Resolve the effective harness from CLI flag, project config, and default,
 * in that precedence order.
 * @param flagValue - Value from `--harness` CLI flag (undefined if not passed)
 * @param projectConfig - Parsed `.lisa.config.json` content
 * @returns The effective harness to use for this run
 */
export function resolveHarness(
  flagValue: Harness | undefined,
  projectConfig: ProjectConfig
): Harness {
  if (flagValue !== undefined) {
    return flagValue;
  }
  if (projectConfig.harness !== undefined) {
    return projectConfig.harness;
  }
  return DEFAULT_HARNESS;
}

/**
 * Type-guard validator for raw parsed config. Throws on invalid harness value.
 * @param parsed - Raw value parsed from JSON (untrusted shape)
 * @param configPath - Absolute path to the source file (used in error messages)
 * @returns A typed ProjectConfig with only the keys we recognize
 */
function validateProjectConfig(
  parsed: unknown,
  configPath: string
): ProjectConfig {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(
      `Invalid ${PROJECT_CONFIG_FILENAME} at ${configPath}: expected JSON object`
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.harness === undefined) {
    return {};
  }
  if (!isHarness(obj.harness)) {
    const allowed = HARNESS_VALUES.join(" | ");
    throw new Error(
      `Invalid harness in ${configPath}: expected ${allowed}, got ${JSON.stringify(obj.harness)}`
    );
  }
  return { harness: obj.harness };
}

/**
 * Narrow an unknown value to the Harness type
 * @param value - Untrusted value to test
 * @returns True if value is one of the canonical Harness strings
 */
export function isHarness(value: unknown): value is Harness {
  return (
    typeof value === "string" &&
    (HARNESS_VALUES as readonly string[]).includes(value)
  );
}
