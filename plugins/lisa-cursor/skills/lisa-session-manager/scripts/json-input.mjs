/**
 * JSON input for the session-manager CLI: parse text or read a file named by
 * a flag, exiting 2 with the source named when it is not valid JSON. Split
 * out of cli-queue.mjs to keep it under the line budget (#4555); cli-queue.mjs
 * re-exports both, so callers keep their import.
 * @module session-manager/json-input
 */
import { readFileSync } from "node:fs";

import { CliError, asSetupError } from "./cli-runtime.mjs";

/**
 * Parse JSON, or exit 2 naming the source.
 * @param {string} text - JSON text
 * @param {string} source - Where it came from
 * @returns {any} Parsed value
 */
export function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${source} is not valid JSON: ${error.message}`, 2);
  }
}

/**
 * Read a JSON file named by a flag, or exit 2.
 * @param {string} file - Path
 * @returns {any} Parsed value
 */
export function readJsonFile(file) {
  const text = asSetupError(() => readFileSync(file, "utf8"));
  return parseJson(text, file);
}
