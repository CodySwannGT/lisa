/**
 * Tracking manifest for Lisa-managed Codex artifacts.
 *
 * When Lisa emits files into a host project's `.codex/` directory, it needs
 * a way to identify those files on the next run so:
 *   1. Stale files (agents/hooks Lisa stopped shipping) can be cleaned up
 *   2. Host-authored files (siblings in `.codex/agents/`, custom hook entries)
 *      are never accidentally overwritten or deleted
 *
 * For agent files specifically we cannot embed marker fields *inside* the
 * TOML itself (Codex's `RawAgentRoleFileToml` deserializer is configured with
 * `#[serde(deny_unknown_fields)]` — a `_lisa_managed` key would cause Codex
 * to reject the file at load time). The manifest is the workaround.
 *
 * The manifest lives at `.codex/.lisa-managed.json` in the destination
 * project. It is checked into the host repo so the cleanup behavior is
 * deterministic across machines.
 * @module codex/manifest
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Filename of the Lisa-managed manifest, relative to `.codex/` */
export const LISA_MANAGED_MANIFEST_FILENAME = ".lisa-managed.json";

/** Schema of `.codex/.lisa-managed.json` */
export interface LisaManagedManifest {
  /**
   * Paths of files Lisa wrote, relative to the `.codex/` directory.
   * Used to identify which files to delete when they stop being shipped.
   */
  readonly files: readonly string[];
}

/**
 * Read the Lisa-managed manifest from `<destDir>/.codex/.lisa-managed.json`.
 * Returns an empty manifest if the file doesn't exist.
 * @param destDir - Absolute path to the destination project root
 * @returns Parsed manifest (with empty file list if absent)
 */
export async function readManagedManifest(
  destDir: string
): Promise<LisaManagedManifest> {
  const manifestPath = path.join(
    destDir,
    ".codex",
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
 * @param destDir - Absolute path to the destination project root
 * @param files - Sorted list of relative-to-`.codex/` file paths Lisa shipped
 */
export async function writeManagedManifest(
  destDir: string,
  files: readonly string[]
): Promise<void> {
  const codexDir = path.join(destDir, ".codex");
  await fse.ensureDir(codexDir);
  const manifestPath = path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME);
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
 * Compute the set of stale files: in the previous manifest but not in the
 * new shipment. These are candidates for deletion.
 * @param previous - Manifest from the prior run
 * @param current - File list Lisa is shipping this run (relative to `.codex/`)
 * @returns Files that should be removed from the host project
 */
export function diffManifests(
  previous: LisaManagedManifest,
  current: readonly string[]
): readonly string[] {
  const currentSet = new Set(current);
  return previous.files.filter(file => !currentSet.has(file));
}

/**
 * Type-guard validator. Throws on shape errors so a corrupted manifest is
 * surfaced rather than silently producing data loss.
 * @param parsed - Untrusted JSON value
 * @param manifestPath - Path used in error messages
 * @returns Validated manifest
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
