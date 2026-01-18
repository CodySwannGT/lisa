import { readFile, writeFile } from "node:fs/promises";
import merge from "lodash.merge";
import { JsonParseError } from "../errors/index.js";

/**
 * Read and parse a JSON file
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new JsonParseError(filePath, error);
    }
    throw error;
  }
}

/**
 * Read JSON file, returning null if file doesn't exist or is invalid
 */
export async function readJsonOrNull<T = unknown>(
  filePath: string
): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

/**
 * Write object as JSON to a file
 */
export async function writeJson(
  filePath: string,
  data: unknown,
  spaces = 2
): Promise<void> {
  const content = JSON.stringify(data, null, spaces);
  await writeFile(filePath, content + "\n", "utf-8");
}

/**
 * Check if a file contains valid JSON
 */
export async function isValidJson(filePath: string): Promise<boolean> {
  try {
    await readJson(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep merge two objects (base values serve as defaults, override values take precedence)
 * Uses lodash.merge for deep merging
 */
export function deepMerge<T extends object>(base: T, override: T): T {
  // Create a new object to avoid mutating inputs
  return merge({}, base, override) as T;
}
