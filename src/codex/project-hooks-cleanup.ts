/** Retire Lisa's legacy project hook overlay now that repo plugins load hooks. */
import * as fse from "fs-extra";
import { readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  mergeLisaHooks,
  parseHooksFile,
  serializeHooksFile,
} from "./hooks-merger.js";

const HOOKS_FILE = path.join(".codex", "hooks.json");
const LEGACY_DIRS = [
  path.join(".codex", "hooks", "lisa"),
  path.join(".codex", "lisa-rules"),
] as const;

/** Result of legacy hook-overlay cleanup. */
export interface ProjectHooksCleanupResult {
  readonly deleted: readonly string[];
}

/**
 * Remove only Lisa-tagged hook handlers and Lisa-owned legacy directories.
 * @param destDir Host project root.
 * @param previousManagedFiles Previous `.codex` ownership entries.
 * @returns Removed Lisa-owned paths.
 */
export async function retireProjectHooks(
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<ProjectHooksCleanupResult> {
  const hooksPath = path.join(destDir, HOOKS_FILE);
  if (await fse.pathExists(hooksPath)) {
    const existing = parseHooksFile(await readFile(hooksPath, "utf8"));
    const hostOnly = mergeLisaHooks(existing, []);
    await writeFile(hooksPath, serializeHooksFile(hostOnly), "utf8");
  }
  await Promise.all(
    LEGACY_DIRS.map(relativeDir =>
      rm(path.join(destDir, relativeDir), { force: true, recursive: true })
    )
  );
  const deleted = previousManagedFiles
    .filter(
      file =>
        file.startsWith(`${path.join("hooks", "lisa")}${path.sep}`) ||
        file.startsWith(`lisa-rules${path.sep}`)
    )
    .sort((left, right) => left.localeCompare(right));
  return { deleted: Object.freeze(deleted) };
}
