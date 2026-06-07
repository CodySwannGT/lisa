/**
 * Tracking manifest for Lisa-managed OpenCode artifacts.
 *
 * When Lisa emits files into a host project's `.opencode/` directory, it needs
 * a way to identify those files on the next run so:
 *   1. Stale files (skills Lisa stopped shipping) can be cleaned up.
 *   2. Host-authored files (custom skills/agents the user added) are never
 *      accidentally overwritten or deleted.
 *
 * The manifest lives at `.opencode/.lisa-managed.json` in the destination
 * project. It is checked into the host repo so the cleanup behavior is
 * deterministic across machines. This mirrors `src/codex/manifest.ts`; the only
 * difference is the config directory (`.opencode/` vs `.codex/`).
 * @module opencode/manifest
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Config directory OpenCode reads project-scope artifacts from */
export const OPENCODE_CONFIG_DIR = ".opencode";

/** Filename of the Lisa-managed manifest, relative to `.opencode/` */
export const LISA_MANAGED_MANIFEST_FILENAME = ".lisa-managed.json";

/** Schema of `.opencode/.lisa-managed.json` */
export interface LisaManagedManifest {
  /**
   * Paths of files Lisa wrote, relative to the `.opencode/` directory.
   * Used to identify which files to delete when they stop being shipped.
   */
  readonly files: readonly string[];
}

/**
 * Read the Lisa-managed manifest from `<destDir>/.opencode/.lisa-managed.json`.
 * Returns an empty manifest if the file doesn't exist.
 * @param destDir - Absolute path to the destination project root.
 * @returns Parsed manifest (with empty file list if absent).
 */
export async function readManagedManifest(
  destDir: string
): Promise<LisaManagedManifest> {
  const manifestPath = path.join(
    destDir,
    OPENCODE_CONFIG_DIR,
    LISA_MANAGED_MANIFEST_FILENAME
  );
  if (!(await fse.pathExists(manifestPath))) {
    return { files: [] };
  }
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateManifest(parsed, manifestPath);
}

/**
 * Write the Lisa-managed manifest to disk, replacing any existing content.
 * @param destDir - Absolute path to the destination project root.
 * @param files - List of relative-to-`.opencode/` file paths Lisa shipped.
 */
export async function writeManagedManifest(
  destDir: string,
  files: readonly string[]
): Promise<void> {
  const configDir = path.join(destDir, OPENCODE_CONFIG_DIR);
  await fse.ensureDir(configDir);
  const manifestPath = path.join(configDir, LISA_MANAGED_MANIFEST_FILENAME);
  const manifest: LisaManagedManifest = {
    files: [...files].sort((a, b) => a.localeCompare(b)),
  };
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Type-guard validator. Throws on shape errors so a corrupted manifest is
 * surfaced rather than silently producing data loss.
 * @param parsed - Untrusted JSON value.
 * @param manifestPath - Path used in error messages.
 * @returns Validated manifest.
 */
function validateManifest(
  parsed: unknown,
  manifestPath: string
): LisaManagedManifest {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(
      `Invalid Lisa-managed manifest at ${manifestPath}: expected JSON object`
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files)) {
    throw new Error(
      `Invalid Lisa-managed manifest at ${manifestPath}: expected "files" array`
    );
  }
  const files = obj.files.filter(
    (file): file is string => typeof file === "string"
  );
  if (files.length !== obj.files.length) {
    throw new Error(
      `Invalid Lisa-managed manifest at ${manifestPath}: "files" must contain only strings`
    );
  }
  return { files: Object.freeze(files) };
}
