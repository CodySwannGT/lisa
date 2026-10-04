/** Retire Lisa's legacy per-hook overlay before fallback reconciliation. */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  mergeLisaHooks,
  parseHooksFile,
  serializeHooksFile,
} from "./hooks-merger.js";

const HOOKS_FILE = path.join(".codex", "hooks.json");
/** Result of legacy hook-overlay cleanup. */
export interface ProjectHooksCleanupResult {
  readonly deleted: readonly string[];
}

/**
 * Remove only Lisa-tagged handlers. Loaded commands still need their files.
 * @param destDir Host project root.
 * @param _previousManagedFiles Previous `.codex` ownership entries.
 * @returns Removed Lisa-owned paths.
 */
export async function retireProjectHooks(
  destDir: string,
  _previousManagedFiles: readonly string[]
): Promise<ProjectHooksCleanupResult> {
  const hooksPath = path.join(destDir, HOOKS_FILE);
  if (await fse.pathExists(hooksPath)) {
    const existing = parseHooksFile(await readFile(hooksPath, "utf8"));
    const hostOnly = mergeLisaHooks(existing, []);
    await writeFile(hooksPath, serializeHooksFile(hostOnly), "utf8");
  }
  return { deleted: Object.freeze([]) };
}
