/**
 * Install Lisa commands as native OpenCode custom commands in
 * `.opencode/commands/`.
 *
 * Pipeline per command:
 *   1. Discover `plugins/<plugin>/commands/**\/*.md` via the shared
 *      `discoverLisaCommands` walker (identical discovery to the skills path).
 *   2. Transform the command Markdown → OpenCode command Markdown (frontmatter
 *      `description`; body preserves `$ARGUMENTS` for native substitution).
 *   3. Write the result to `.opencode/commands/<lisa-name>.md`, where the
 *      filename is the shared dash-joined `lisa-` prefixed name (e.g.
 *      `lisa-git-commit`), so the command surfaces as `/lisa-git-commit`.
 *
 * This is ADDITIVE and native-fidelity: Lisa commands already work on OpenCode
 * as `lisa-` prefixed skills, so the lower-priority value here is exposing them
 * through OpenCode's first-class command surface with native argument handling.
 *
 * The `lisa-` filename prefix (already baked into the shared command skill name)
 * is the ownership boundary — host-authored commands (any file NOT starting with
 * `lisa-`) are never touched, and stale cleanup is scoped to `lisa-` files only.
 * @module opencode/command-installer
 */
import * as fse from "fs-extra";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type LisaCommandSource,
  discoverLisaCommands,
  isHarnessVariantPlugin,
} from "../core/lisa-skill-sources.js";
import { transformCommandToOpencode } from "./command-transformer.js";
import { OPENCODE_CONFIG_DIR } from "./manifest.js";

export {
  type LisaCommandSource,
  discoverLisaCommands,
} from "../core/lisa-skill-sources.js";

/** Subdirectory inside `.opencode/` where Lisa-owned commands live */
export const LISA_COMMANDS_SUBDIR = "commands";

/**
 * Filename prefix marking a command file as Lisa-owned. The shared command
 * discovery already names every command `lisa-<...>`, so this matches the
 * basename of every file Lisa writes and scopes stale cleanup safely.
 */
export const LISA_COMMAND_FILE_PREFIX = "lisa-";

/** Result of installing one command */
export interface InstalledCommand {
  /** Command name (the `lisa-` prefixed, dash-joined skill name) */
  readonly name: string;
  /** Path written, relative to the destination project's `.opencode/` directory */
  readonly relativePath: string;
}

/** Aggregated result of an install pass */
export interface CommandInstallResult {
  readonly installed: readonly InstalledCommand[];
  /** Stale command files deleted from `.opencode/commands/` (relative to `.opencode/`) */
  readonly deleted: readonly string[];
  /** Files written, relative to `.opencode/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
}

/**
 * Install all discovered commands into `<destDir>/.opencode/commands/`.
 * @param sources - Command sources from discoverLisaCommands
 * @param destDir - Absolute path to the destination project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.opencode/`); used to detect stale commands to delete
 * @returns Result describing installed/deleted/managedFiles
 */
export async function installCommands(
  sources: readonly LisaCommandSource[],
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<CommandInstallResult> {
  const commandsDir = path.join(
    destDir,
    OPENCODE_CONFIG_DIR,
    LISA_COMMANDS_SUBDIR
  );
  await fse.ensureDir(commandsDir);

  const installed: readonly InstalledCommand[] = await Promise.all(
    sources.map(source => installSingleCommand(source, commandsDir))
  );
  const managedFiles: readonly string[] = installed.map(
    command => command.relativePath
  );

  const deleted = await deleteStaleCommands(
    previousManagedFiles,
    managedFiles,
    destDir
  );

  return {
    installed: Object.freeze(installed),
    deleted: Object.freeze(deleted),
    managedFiles: Object.freeze(managedFiles),
  };
}

/**
 * Transform + write a single command file.
 * @param source - Discovered command source (skill name, display name, path)
 * @param commandsDir - Absolute path to `.opencode/commands/` in the host
 * @returns Result describing the installed file
 */
async function installSingleCommand(
  source: LisaCommandSource,
  commandsDir: string
): Promise<InstalledCommand> {
  const sourceContent = await readFile(source.sourcePath, "utf8");
  const markdown = transformCommandToOpencode(
    sourceContent,
    source.displayName
  );
  const filename = `${source.skillName}.md`;
  await writeFile(path.join(commandsDir, filename), markdown, "utf8");
  return {
    name: source.skillName,
    relativePath: path.join(LISA_COMMANDS_SUBDIR, filename),
  };
}

/**
 * Delete files that were Lisa-managed last run but aren't shipped this run.
 * Only deletes files inside `.opencode/commands/` whose basename carries the
 * `lisa-` prefix, so host-authored commands are never removed.
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.opencode/`)
 * @param currentManagedFiles - Files Lisa is shipping this run (relative
 *   to `.opencode/`)
 * @param destDir - Absolute path to the host project root
 * @returns The list of relative paths that were deleted
 */
async function deleteStaleCommands(
  previousManagedFiles: readonly string[],
  currentManagedFiles: readonly string[],
  destDir: string
): Promise<readonly string[]> {
  const currentSet = new Set(currentManagedFiles);
  const lisaCommandPrefix = `${LISA_COMMANDS_SUBDIR}${path.sep}${LISA_COMMAND_FILE_PREFIX}`;
  const stale = previousManagedFiles.filter(
    file => !currentSet.has(file) && file.startsWith(lisaCommandPrefix)
  );
  await Promise.all(
    stale.map(async file => {
      const absPath = path.join(destDir, OPENCODE_CONFIG_DIR, file);
      if (await fse.pathExists(absPath)) {
        await unlink(absPath);
      }
    })
  );
  return Object.freeze(stale);
}

/**
 * Convenience one-shot: discover Lisa commands from `lisaDir` and install them.
 *
 * Discovery is restricted to canonical plugins — the per-harness fanout variants
 * (`*-agy`, `*-copilot`, `*-cursor`) are skipped so a reformatted variant copy
 * of a command body never wins the last-wins dedup over the canonical source.
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @param destDir - Absolute path to the destination project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 * @returns Result describing installed/deleted/managedFiles
 */
export async function discoverAndInstallCommands(
  lisaDir: string,
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<CommandInstallResult> {
  const sources = await discoverLisaCommands(
    lisaDir,
    name => !isHarnessVariantPlugin(name)
  );
  return installCommands(sources, destDir, previousManagedFiles);
}
