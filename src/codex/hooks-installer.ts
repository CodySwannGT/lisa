/**
 * Legacy full installer for Lisa-managed Codex hooks in a host project.
 *
 * Pipeline:
 *   1. Filter hook catalog by detected project types
 *   2. Link each script from `src/codex/scripts/` → `.codex/hooks/lisa/`
 *   3. For inject-rules: link Lisa rules into `.codex/lisa-rules/`
 *   4. Tagged-merge `.codex/hooks.json`
 *
 * Codex hook event support map (vs. Lisa's existing Claude Code hooks),
 * verified against codex-cli 0.125.0 by source-read + runtime tests:
 *   - SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop  ✅
 *   - PermissionRequest                                             ✅ (Codex-only)
 *   - SubagentStart, SessionEnd, Notification, PreCompact           ❌ (Codex doesn't have these)
 *
 * Claude hooks intentionally NOT ported (no Codex equivalent):
 *   - inject-flow-context.sh — fires on SubagentStart, which Codex lacks.
 *   - the SessionEnd `entire` hook — Codex has no SessionEnd event.
 * inject-rules also fires on SubagentStart under Claude; on Codex only its
 * SessionStart variant applies (Codex has no per-subagent start event).
 *
 * The project overlay now uses plugin-bundled hooks for the complete catalog
 * and one repository-owned enforcement dispatcher as the fail-closed delivery
 * fallback. This module remains for migration coverage of the retired linked
 * script/rule layout and source-owned compatibility copies for loaded sessions.
 * @module codex/hooks-installer
 */
import * as fse from "fs-extra";
import { rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { mirrorLisaRules } from "../core/lisa-rules-mirror.js";
import {
  EDIT_GATE_LIB,
  EDIT_PATHS_LIB,
  HARPER_PLUGIN,
  HOOKS_FILENAME,
  type HookCatalogEntry,
  INJECT_RULES_ID,
  INSTALL_RAILS_HOOKS_ID,
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
  catalogEntryToSpec,
  filterCatalogByTypes,
  harperSupportSources,
  linkManagedFile,
  railsHookSupportSources,
  readHooksFile,
  resolveBundledScript,
  resolveHookScript,
} from "./hooks-catalog.js";
import { mergeLisaHooks, serializeHooksFile } from "./hooks-merger.js";

export {
  EDIT_GATE_LIB,
  EDIT_PATHS_LIB,
  EDIT_TIME_HOOK_SCRIPTS,
  HOOKS_FILENAME,
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
} from "./hooks-catalog.js";
export { installHookCompatibility } from "./hooks-compatibility.js";

/** Result of the hooks install pass */
export interface HooksInstallResult {
  /** Files written, relative to `.codex/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
  /** Number of Lisa hook entries written into hooks.json */
  readonly hookEntries: number;
  /** Stale Lisa-owned hook/rule files removed from the project. */
  readonly deleted: readonly string[];
}

/**
 * Install Lisa hook scripts + rules + hooks.json entries.
 * @param lisaDir - Absolute path to the Lisa repo root (or installed package)
 * @param destDir - Absolute path to the host project root
 * @param detectedTypes - Project types Lisa detected; used to filter stack-
 *   specific hooks. Always includes the universal hooks regardless.
 * @param previousManagedFiles - Files Lisa managed on the previous run.
 * @returns Result describing what was written
 */
export async function installHooks(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[],
  previousManagedFiles: readonly string[] = []
): Promise<HooksInstallResult> {
  const codexDir = path.join(destDir, ".codex");
  const hooksDir = path.join(codexDir, LISA_HOOKS_SUBDIR);
  const rulesDir = path.join(codexDir, LISA_RULES_SUBDIR);
  await fse.ensureDir(hooksDir);
  await fse.ensureDir(rulesDir);

  const applicable = filterCatalogByTypes(detectedTypes);

  // Step 1: link every applicable script and collect their relative paths
  const scriptFiles: readonly string[] = await Promise.all(
    applicable.map(async entry => {
      const scriptSource = resolveHookScript(lisaDir, entry);
      const scriptDest = path.join(hooksDir, entry.scriptFilename);
      await linkManagedFile(scriptSource, scriptDest);
      return path.join(LISA_HOOKS_SUBDIR, entry.scriptFilename);
    })
  );

  // Step 1b: link the shared edit-path helper when any installed hook sources
  // it. Edit-aware hooks (format/lint/sg-scan/rubocop/block-migration) source
  // this for apply_patch path parsing.
  //
  // Step 1c does the same for the gate façade helper, which every edit-time
  // hook sources before it resolves a tool. It was missing here for as long as
  // the façade has existed, which made the façade inert on this surface — see
  // `needsEditGate`.
  const sharedLibs: readonly string[] = [
    ...(applicable.some(entry => entry.needsEditPathLib)
      ? [EDIT_PATHS_LIB]
      : []),
    ...(applicable.some(entry => entry.needsEditGate) ? [EDIT_GATE_LIB] : []),
  ];
  const libFiles: readonly string[] = await Promise.all(
    sharedLibs.map(async lib => {
      await linkManagedFile(
        resolveBundledScript(lib),
        path.join(hooksDir, lib)
      );
      return path.join(LISA_HOOKS_SUBDIR, lib);
    })
  );

  const catalogSupportFiles = await linkCatalogSupportFiles(
    lisaDir,
    hooksDir,
    applicable
  );

  // Step 2: mirror rules from Lisa into .codex/lisa-rules/ (only when
  // inject-rules is being installed — i.e., always, since it's a "*" hook)
  const ruleFiles: readonly string[] = applicable.some(
    e => e.id === INJECT_RULES_ID
  )
    ? (await mirrorLisaRules(lisaDir, rulesDir, detectedTypes, "link")).map(
        file => path.join(LISA_RULES_SUBDIR, file)
      )
    : [];

  // Step 3: tagged-merge hooks.json
  const hooksFilePath = path.join(codexDir, HOOKS_FILENAME);
  const existing = await readHooksFile(hooksFilePath);
  const lisaHookSpecs = applicable.map(entry =>
    catalogEntryToSpec(entry, destDir)
  );
  const merged = mergeLisaHooks(existing, lisaHookSpecs);
  await writeFile(hooksFilePath, serializeHooksFile(merged), "utf8");

  const managedFiles = [
    ...scriptFiles,
    ...libFiles,
    ...catalogSupportFiles,
    ...ruleFiles,
    HOOKS_FILENAME,
  ];
  const deleted = await deleteStaleHookFiles(
    previousManagedFiles,
    new Set(managedFiles),
    codexDir
  );

  return {
    managedFiles: Object.freeze(managedFiles),
    hookEntries: lisaHookSpecs.length,
    deleted: Object.freeze(deleted),
  };
}

/**
 * Link the dependency closures selected by the installed catalog.
 * @param lisaDir Source/package root
 * @param hooksDir Host hook directory
 * @param applicable Filtered catalog entries
 * @returns Paths tracked in the host's managed-file manifest
 */
async function linkCatalogSupportFiles(
  lisaDir: string,
  hooksDir: string,
  applicable: readonly HookCatalogEntry[]
): Promise<readonly string[]> {
  const harper = applicable.some(entry => entry.sourcePlugin === HARPER_PLUGIN)
    ? await linkHarperSupportFiles(lisaDir, hooksDir)
    : [];
  if (!applicable.some(entry => entry.id === INSTALL_RAILS_HOOKS_ID))
    return harper;
  const rails = await Promise.all(
    railsHookSupportSources(lisaDir).map(async ({ source, filename }) => {
      await linkManagedFile(source, path.join(hooksDir, filename));
      return path.join(LISA_HOOKS_SUBDIR, filename);
    })
  );
  return [...harper, ...rails];
}

/** Project-local directory prefixes wholly owned by the hook installer. */
const MANAGED_HOOK_PREFIXES = [
  `${LISA_HOOKS_SUBDIR}${path.sep}`,
  `${LISA_RULES_SUBDIR}${path.sep}`,
] as const;

/**
 * Delete hook scripts and mirrored rules that disappeared from the applicable
 * project stack. Files outside Lisa-owned directories are never considered.
 * @param previousManagedFiles Previous `.codex/.lisa-managed.json` file list.
 * @param currentManagedFiles Current hook/rule file set.
 * @param codexDir Absolute project `.codex` directory.
 * @returns Sorted relative paths that were removed.
 */
async function deleteStaleHookFiles(
  previousManagedFiles: readonly string[],
  currentManagedFiles: ReadonlySet<string>,
  codexDir: string
): Promise<readonly string[]> {
  const stale = previousManagedFiles
    .filter(file =>
      MANAGED_HOOK_PREFIXES.some(prefix => file.startsWith(prefix))
    )
    .filter(file => !currentManagedFiles.has(file))
    .sort((left, right) => left.localeCompare(right));

  await Promise.all(
    stale.map(file => rm(path.join(codexDir, file), { force: true }))
  );
  return stale;
}

/**
 * Link Harper hook companion files beside their project-local wrappers.
 * @param lisaDir Lisa package root.
 * @param hooksDir Project-local hook directory.
 * @returns Managed paths relative to `.codex/`.
 */
async function linkHarperSupportFiles(
  lisaDir: string,
  hooksDir: string
): Promise<readonly string[]> {
  const sources = harperSupportSources(lisaDir);
  await Promise.all(
    sources.map(({ source, filename }) =>
      linkManagedFile(source, path.join(hooksDir, filename))
    )
  );
  return sources.map(({ filename }) => path.join(LISA_HOOKS_SUBDIR, filename));
}
