/** Bounded, no-follow local project reads shared by localhost UI probes. */
import { realpath } from "node:fs/promises";
import { readProjectText } from "../health/read-only-fs.js";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { deepMerge } from "../utils/index.js";

/**
 * Read one project-relative text file through deterministic Health confinement.
 * @param projectRoot - Project root, canonicalized before the read
 * @param relativePath - Strict project-relative path
 * @returns Bounded UTF-8 text, or undefined when absent
 */
export async function readConfinedProjectText(
  projectRoot: string,
  relativePath: string
): Promise<string | undefined> {
  const root = await realpath(projectRoot);
  return await readProjectText(root, relativePath);
}

/**
 * Read and parse one confined JSON file.
 * @param projectRoot - Project root
 * @param relativePath - Strict project-relative JSON path
 * @returns Parsed JSON, or undefined when absent
 */
export async function readConfinedProjectJson(
  projectRoot: string,
  relativePath: string
): Promise<unknown | undefined> {
  const text = await readConfinedProjectText(projectRoot, relativePath);
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

/**
 * Read committed-plus-local Lisa config without following unsafe files.
 * @param projectRoot - Project root
 * @returns Merged config with the local overlay winning per key
 */
export async function readConfinedMergedConfig(
  projectRoot: string
): Promise<JsonObject> {
  const [committed, local] = await Promise.all([
    readConfinedProjectJson(projectRoot, ".lisa.config.json"),
    readConfinedProjectJson(projectRoot, ".lisa.config.local.json"),
  ]);
  return deepMerge(
    isJsonObject(committed) ? committed : {},
    isJsonObject(local) ? local : {}
  ) as JsonObject;
}
