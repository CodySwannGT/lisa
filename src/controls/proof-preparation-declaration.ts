/** Read the proof-copy setup declaration without running its commands. */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { parseProblemWithoutExcerpt } from "./secret-scan-json.js";

/** The configuration key named when the declaration cannot be read. */
const PREPARE_KEY = "controls.proof_copy.prepare";
const CONFIG_FILE = ".lisa.config.json";

/** The configured prepare commands or the reason they could not be used. */
type ProofPreparationRead =
  | {
      readonly problem: null;
      readonly commands: readonly (readonly string[])[];
    }
  | { readonly problem: string };

/**
 * Read and validate proof-copy preparation without reading external files.
 * @param root - The checkout whose config governs preparation
 * @returns Argument lists or the first declaration problem
 */
export function readProofPreparation(root: string): ProofPreparationRead {
  try {
    const file = path.join(root, CONFIG_FILE);
    if (!lstatSync(file).isFile()) {
      return {
        problem: `Cannot read ${PREPARE_KEY} because ${CONFIG_FILE} is not an ordinary file.`,
      };
    }
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const controls = isJsonObject(parsed) ? parsed.controls : undefined;
    const copy = isJsonObject(controls) ? controls.proof_copy : undefined;
    if (copy !== undefined && !isJsonObject(copy)) {
      return { problem: "controls.proof_copy must be an object." };
    }
    const commands: unknown = copy?.prepare;
    if (commands === undefined) return { problem: null, commands: [] };
    if (!Array.isArray(commands) || !commands.every(isArgumentList)) {
      return {
        problem: `${PREPARE_KEY} must be a list of non-empty argument lists, such as [["bun", "install", "--frozen-lockfile"]].`,
      };
    }
    return { problem: null, commands };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { problem: null, commands: [] };
    return {
      problem: `Could not read ${PREPARE_KEY}. ${parseProblemWithoutExcerpt(error)}`,
    };
  }
}

/**
 * Tell whether a configured command can be passed directly as argv.
 * @param command - Untrusted config data
 * @returns Whether it names an executable followed by string arguments
 */
function isArgumentList(command: unknown): command is readonly string[] {
  return (
    Array.isArray(command) &&
    typeof command[0] === "string" &&
    command[0].trim().length > 0 &&
    command.every(value => typeof value === "string" && !value.includes("\0"))
  );
}
