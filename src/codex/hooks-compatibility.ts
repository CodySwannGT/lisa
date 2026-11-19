/**
 * Loaded-session compatibility for the retired linked Codex hook layout.
 *
 * Earlier Lisa versions linked hook scripts and rules into `.codex/`. A
 * session that already loaded those commands keeps invoking them, so this pass
 * replaces each previously owned link with a regular copy of the shipped
 * source (plus its helper closure) without registering it again, and never
 * touches host-authored files.
 * @module codex/hooks-compatibility
 */
import * as fse from "fs-extra";
import {
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { mirrorLisaRules } from "../core/lisa-rules-mirror.js";
import {
  EDIT_GATE_LIB,
  EDIT_PATHS_LIB,
  HARPER_PLUGIN,
  HOOK_CATALOG,
  HOOKS_FILENAME,
  type HookCatalogEntry,
  type HookSupportSource,
  INJECT_RULES_ID,
  INSTALL_RAILS_HOOKS_ID,
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
  catalogEntryToSpec,
  harperSupportSources,
  railsHookSupportSources,
  readHooksFile,
  resolveBundledScript,
  resolveHookScript,
} from "./hooks-catalog.js";
import { isManagedSourceLink } from "./hooks-source-links.js";

/**
 * Keep previously installed catalog commands functional without registering
 * them again. Copies outlive replacement of the package that owned old links.
 * Host-authored siblings are never pruned. This is an apply-time migration,
 * not runtime/session detection or an assumed hot-reload boundary.
 * @param lisaDir Lisa source/package root.
 * @param destDir Host root.
 * @param detectedTypes Current project types.
 * @param previousManagedFiles Previous manifest ownership.
 * @returns Compatibility files to retain in the current manifest.
 */
export async function installHookCompatibility(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[],
  previousManagedFiles: readonly string[]
): Promise<readonly string[]> {
  const codexDir = path.join(destDir, ".codex");
  const hooksDir = path.join(codexDir, LISA_HOOKS_SUBDIR);
  const existing = await readHooksFile(path.join(codexDir, HOOKS_FILENAME));
  const taggedCommands = new Set(
    Object.values(existing.hooks ?? {}).flatMap(groups =>
      groups.flatMap(group =>
        group.hooks
          .filter(hook => hook._lisaManaged === true)
          .map(hook => hook.command)
      )
    )
  );
  const owned = new Set([
    ...previousManagedFiles,
    ...HOOK_CATALOG.filter(entry =>
      taggedCommands.has(catalogEntryToSpec(entry, destDir).command)
    ).map(entry => path.join(LISA_HOOKS_SUBDIR, entry.scriptFilename)),
  ]);
  const candidates = await Promise.all(
    HOOK_CATALOG.map(async entry => {
      const relative = path.join(LISA_HOOKS_SUBDIR, entry.scriptFilename);
      const keep =
        owned.has(relative) ||
        taggedCommands.has(catalogEntryToSpec(entry, destDir).command) ||
        (await isManagedSourceLink(
          path.join(codexDir, relative),
          resolveHookScript(lisaDir, entry),
          lisaDir,
          destDir
        ));
      return keep ? entry : undefined;
    })
  );
  const retained = candidates.filter(
    (entry): entry is HookCatalogEntry => entry !== undefined
  );
  if (retained.length === 0) return [];
  const sources = compatibilitySources(lisaDir, retained);
  await assertCompatibilityOwnership(
    sources,
    codexDir,
    owned,
    lisaDir,
    destDir
  );
  await fse.ensureDir(hooksDir);
  const entrypoints = new Set(retained.map(entry => entry.scriptFilename));
  const rules = retained.some(entry => entry.id === INJECT_RULES_ID)
    ? await copyCompatibilityRules(
        lisaDir,
        codexDir,
        detectedTypes,
        retained,
        owned
      )
    : [];
  // Install complete dependencies before atomically replacing loaded entrypoints.
  const helpers = await copyCompatibilitySources(
    sources.filter(source => !entrypoints.has(source.filename)),
    codexDir
  );
  const scripts = await copyCompatibilitySources(
    sources.filter(source => entrypoints.has(source.filename)),
    codexDir
  );
  return Object.freeze([...scripts, ...helpers, ...rules]);
}

/**
 * Reject unknown companion collisions before changing any compatibility file.
 * A retained command does not grant ownership of a host-authored helper.
 * @param sources Complete catalog closure.
 * @param codexDir Host Codex root.
 * @param owned Proven manifest/tagged-handler ownership.
 * @param lisaDir Verified Lisa package root.
 * @param destDir Host root.
 */
async function assertCompatibilityOwnership(
  sources: readonly HookSupportSource[],
  codexDir: string,
  owned: ReadonlySet<string>,
  lisaDir: string,
  destDir: string
): Promise<void> {
  await Promise.all(
    sources.map(async ({ source, filename }) => {
      const relative = path.join(LISA_HOOKS_SUBDIR, filename);
      const destination = path.join(codexDir, relative);
      const stat = await lstat(destination).catch(error => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!stat || owned.has(relative)) return;
      if (stat.isSymbolicLink()) {
        if (await isManagedSourceLink(destination, source, lisaDir, destDir))
          return;
      } else if (
        stat.isFile() &&
        (await readFile(destination)).equals(await readFile(source))
      ) {
        return;
      }
      throw new Error(
        `Cannot migrate Codex hooks: .codex/${relative} contains host-owned content. No compatibility files were changed. Preserve it and resolve the source ownership conflict before applying again.`
      );
    })
  );
}

/**
 * Copy one dependency group before exposing dependent entrypoints.
 * @param sources Package implementations.
 * @param codexDir Host Codex directory.
 * @returns Installed paths.
 */
async function copyCompatibilitySources(
  sources: readonly HookSupportSource[],
  codexDir: string
): Promise<readonly string[]> {
  return Promise.all(
    sources.map(async ({ source, filename }) => {
      const relative = path.join(LISA_HOOKS_SUBDIR, filename);
      await copyManagedCompatibility(source, path.join(codexDir, relative));
      return relative;
    })
  );
}

/**
 * Resolve the full helper/data closure from the existing hook catalog.
 * @param lisaDir Source/package root.
 * @param retained Previously installed catalog entries.
 * @returns Script and companion sources.
 */
function compatibilitySources(
  lisaDir: string,
  retained: readonly HookCatalogEntry[]
): readonly HookSupportSource[] {
  const helpers = [
    ...(retained.some(entry => entry.needsEditPathLib) ? [EDIT_PATHS_LIB] : []),
    ...(retained.some(entry => entry.needsEditGate) ? [EDIT_GATE_LIB] : []),
  ];
  return [
    ...retained.map(entry => ({
      source: resolveHookScript(lisaDir, entry),
      filename: entry.scriptFilename,
    })),
    ...helpers.map(filename => ({
      source: resolveBundledScript(filename),
      filename,
    })),
    ...(retained.some(entry => entry.id === INSTALL_RAILS_HOOKS_ID)
      ? railsHookSupportSources(lisaDir)
      : []),
    ...(retained.some(entry => entry.sourcePlugin === "lisa")
      ? [
          {
            source: path.join(lisaDir, "plugins/lisa/hooks/guard-dedupe.bash"),
            filename: "guard-dedupe.bash",
          },
        ]
      : []),
    ...(retained.some(entry => entry.sourcePlugin === HARPER_PLUGIN)
      ? harperSupportSources(lisaDir)
      : []),
  ];
}

/**
 * Copy rule dependencies without replacing host-authored rules.
 * @param lisaDir Source/package root.
 * @param codexDir Host Codex directory.
 * @param detectedTypes Current types.
 * @param retained Entries determining required earlier stack rules.
 * @param owned Prior manifest paths.
 * @returns Copied rule paths.
 */
async function copyCompatibilityRules(
  lisaDir: string,
  codexDir: string,
  detectedTypes: readonly ProjectType[],
  retained: readonly HookCatalogEntry[],
  owned: ReadonlySet<string>
): Promise<readonly string[]> {
  const ruleTypes = [
    ...new Set([
      ...detectedTypes,
      ...retained.flatMap(entry =>
        entry.forProjectTypes.filter(type => type !== "*")
      ),
    ]),
  ];
  const scratch = await mkdtemp(path.join(codexDir, ".compat-rules-"));
  try {
    const rules = await mirrorLisaRules(lisaDir, scratch, ruleTypes, "link");
    const copied = await Promise.all(
      rules.map(async relativeRule => {
        const relative = path.join(LISA_RULES_SUBDIR, relativeRule);
        const destination = path.join(codexDir, relative);
        const stat = await lstat(destination).catch(() => undefined);
        const source = await readlink(path.join(scratch, relativeRule));
        const linkedRule =
          stat?.isSymbolicLink() &&
          (await isManagedSourceLink(
            destination,
            source,
            lisaDir,
            path.dirname(codexDir)
          ));
        if (stat && !linkedRule && !owned.has(relative)) return undefined;
        await fse.ensureDir(path.dirname(destination));
        await copyManagedCompatibility(
          path.join(scratch, relativeRule),
          destination
        );
        return relative;
      })
    );
    return copied.filter((file): file is string => file !== undefined);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Replace a managed representation with executable regular source bytes.
 * @param source Functional shipped implementation.
 * @param destination Old loaded-command path.
 */
async function copyManagedCompatibility(
  source: string,
  destination: string
): Promise<void> {
  const content = await readFile(source);
  const scratch = await mkdtemp(
    path.join(path.dirname(destination), ".compat-file-")
  );
  try {
    const replacement = path.join(scratch, "replacement");
    await writeFile(replacement, content, { mode: 0o755 });
    await rename(replacement, destination);
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}
