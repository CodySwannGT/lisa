/**
 * The gate runner and the files it needs, read from the running Lisa
 * package.
 *
 * A repository Lisa was never applied to has no runner for a carrier to
 * start, so the command places one. It places the runner's entry file and
 * the threshold ratchet a declaration can invoke directly, and every file
 * those entries reach through a relative import, a relative
 * `new URL(..., import.meta.url)` or a helper's `$PSScriptRoot`, found by
 * following those references from the entry: the registry, and the part of
 * `lib/` the runner uses. Nothing
 * else in the package's scripts folder is copied.
 *
 * The runner needs no installed dependency: every other import it makes is a
 * Node built-in.
 * @module controls/carrier-runner-files
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveGateRegistryPath } from "../cli/gate-registry-source.js";
import { compareCodeUnits } from "./canonical-json.js";
import {
  CARRIER_RUNNER_FILE,
  CARRIER_RUNNER_FOLDER,
  type PlacedFile,
} from "./carrier-types.js";

/** Package programs a fresh carrier can run without applying a stack. */
const RUNNER_ENTRIES = [CARRIER_RUNNER_FILE, "check-threshold-ratchet.mjs"];

/** `import … from "./x"` and `export … from "./x"`, at the start of a line. */
const FROM_REFERENCE =
  /(?:^|\n)[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/gu;

/** A bare `import "./x"`, at the start of a line. */
const BARE_REFERENCE = /(?:^|\n)[ \t]*import\s*["'](\.{1,2}\/[^"']+)["']/gu;

/** `new URL("./x", import.meta.url)`: a file read from beside the module. */
const URL_REFERENCE =
  /new URL\(\s*["']([\w./-]+)["']\s*,\s*import\.meta\.url\s*\)/gu;

/** `Join-Path $PSScriptRoot 'x'`: a file a PowerShell helper reads beside it. */
const SCRIPT_ROOT_REFERENCE = /Join-Path \$PSScriptRoot ["']([\w.-]+)["']/gu;

/**
 * The files one file refers to by a relative path.
 * @param file - The referring file, from the scripts folder
 * @param text - Its content
 * @returns The files it refers to, from the scripts folder
 */
function references(file: string, text: string): readonly string[] {
  return [FROM_REFERENCE, BARE_REFERENCE, URL_REFERENCE, SCRIPT_ROOT_REFERENCE]
    .flatMap(pattern => Array.from(text.matchAll(pattern)))
    .flatMap(match => (match[1] === undefined ? [] : [match[1]]))
    .map(specifier =>
      path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
    );
}

/**
 * Read a file and every file it reaches, each once.
 * @param folder - The scripts folder of the Lisa package
 * @param pending - The files still to read, from that folder
 * @param read - The files read so far
 * @returns Every file reached, by its path from the scripts folder
 * @throws {Error} When a reference leads out of the scripts folder
 */
async function reach(
  folder: string,
  pending: readonly string[],
  read: ReadonlyMap<string, Buffer>
): Promise<ReadonlyMap<string, Buffer>> {
  const [file, ...rest] = pending;
  if (file === undefined) return read;
  if (read.has(file)) return reach(folder, rest, read);
  if (file.startsWith("../")) {
    throw new Error(
      `The gate runner refers to ${file}, which is outside the scripts folder of this copy of Lisa, so it cannot be placed in a repository. Reinstall Lisa.`
    );
  }
  const content = await readFile(path.join(folder, file));
  return reach(
    folder,
    [...rest, ...references(file, content.toString("utf8"))],
    new Map([...read, [file, content]])
  );
}

/**
 * The folder of the running Lisa package that holds the gate runner.
 * @returns Its absolute path
 * @throws {Error} When this copy of Lisa does not hold the runner
 */
function packageScriptsFolder(): string {
  const registry = resolveGateRegistryPath();
  if (registry === null) {
    throw new Error(
      "The gate runner is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lisa-run-gates.mjs). Reinstall Lisa."
    );
  }
  return path.dirname(registry);
}

/**
 * The runner and everything it needs, as files to place in a repository.
 * @param scriptsFolder - The folder to read from; the running Lisa package's
 *   scripts folder by default
 * @returns The files, in path order, each under the repository's runner
 *   folder
 */
export async function runnerFiles(
  scriptsFolder: string = packageScriptsFolder()
): Promise<readonly PlacedFile[]> {
  const reached = await reach(scriptsFolder, RUNNER_ENTRIES, new Map());
  return [...reached.entries()]
    .map(([file, content]) => ({
      content,
      executable: false,
      path: `${CARRIER_RUNNER_FOLDER}/${file}`,
    }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
}
