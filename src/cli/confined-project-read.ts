/** Bounded, no-follow local project reads for setup and doctor checks. */
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
async function readConfinedProjectText(
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
 * @param strict - Require an object without exposing malformed source text.
 * @returns Parsed JSON, or undefined when absent
 */
async function readConfinedProjectJson(
  projectRoot: string,
  relativePath: string,
  strict: boolean
): Promise<unknown | undefined> {
  const text = await readConfinedProjectText(projectRoot, relativePath);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (strict && !isJsonObject(value)) {
      throw new TypeError(`${relativePath} must contain a JSON object`);
    }
    return value;
  } catch (error) {
    if (!strict || !(error instanceof SyntaxError)) throw error;
    throw new Error(`Could not parse ${relativePath} as JSON`, {
      cause: error,
    });
  }
}

/**
 * Read committed-plus-local Lisa config without following unsafe files.
 * @param projectRoot - Project root
 * @param strict - Refuse a present configuration with a non-object root.
 * @returns Merged config with the local overlay winning per key
 */
export async function readConfinedMergedConfig(
  projectRoot: string,
  strict = false
): Promise<JsonObject> {
  const [committed, local] = await Promise.all([
    readConfinedProjectJson(projectRoot, ".lisa.config.json", strict),
    readConfinedProjectJson(projectRoot, ".lisa.config.local.json", strict),
  ]);
  return deepMerge(
    isJsonObject(committed) ? committed : {},
    isJsonObject(local) ? local : {}
  ) as JsonObject;
}
