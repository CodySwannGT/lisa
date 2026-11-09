/**
 * Emit the plugin-level modules that bundled skill scripts import from outside
 * their own skill folder (CodySwannGT/lisa#4642).
 *
 * A skill script such as `lisa-session-manager/scripts/cli-cycle.mjs` imports
 * `../../../scripts/automation-run-record.mjs`. Inside a Lisa plugin that path
 * lands on the plugin's own `scripts/` directory. Once the skill is copied to
 * `.opencode/skills/lisa/<skill>/`, the same unchanged specifier lands on
 * `.opencode/skills/scripts/`, so this module copies each such target there —
 * preserving the relative layout instead of rewriting any specifier.
 *
 * The source of an emitted target is found by the same mapping the plugin
 * relies on: `.opencode/skills/` stands where the plugin root stands
 * (`plugins/<p>/`), because `skills/lisa/<n>/scripts/` and `skills/<n>/scripts/`
 * are both three levels below it. Resolving against the skill's own source
 * folder would be wrong for skills discovered under `.codex-plugin/skills/`,
 * whose `../../../` lands on `.codex-plugin/` rather than the plugin root.
 *
 * The file list is DERIVED from the import specifiers of the emitted files,
 * transitively (a shared module's own relative imports are followed too), so a
 * new import is covered the day it lands. There is no hand-written list.
 *
 * Two skills from different plugins may reach the same emitted path. Identical
 * content is copied once; different content is a packaging defect and fails
 * the emit loudly rather than shipping whichever module happened to win.
 *
 * Emitted paths are Lisa-managed: a host file at the same path is overwritten,
 * exactly as for every other managed path in `.opencode/`.
 *
 * Returned paths use forward slashes on every platform, matching how the
 * `.lisa-managed.json` manifest stores them (`opencode/manifest`).
 * @module opencode/shared-scripts-emitter
 */
import * as fse from "fs-extra";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { BundledSkillSource } from "../core/lisa-skill-sources.js";
import {
  SHARED_SCRIPTS_PREFIX,
  toManifestPath,
} from "./shared-scripts-cleanup.js";
import {
  isScriptModule,
  isWithin,
  resolveRelativeImports,
} from "./relative-imports.js";

/** One module to emit: where it comes from and where it lands. */
interface SharedModule {
  /** Absolute source path inside the Lisa package. */
  readonly sourcePath: string;
  /** Emitted path, relative to `.opencode/`. */
  readonly emittedRelative: string;
  /** Absolute root of the plugin the module ships in (`plugins/<p>`). */
  readonly pluginRoot: string;
}

/** A module whose relative imports still need following. */
interface PendingModule {
  /** Absolute source path inside the Lisa package. */
  readonly sourcePath: string;
  /** Absolute path the module occupies in the emitted tree. */
  readonly emittedPath: string;
  /** Absolute root of the plugin the module ships in (`plugins/<p>`). */
  readonly pluginRoot: string;
}

/** Name of the per-plugin directory holding Codex-specific skill roots. */
const CODEX_PLUGIN_DIR = ".codex-plugin";

/** Emitted directory that stands in for a plugin root (`.opencode/skills`). */
const SHARED_ROOT_SUBDIR = "skills";

/** Where the emit writes and which part of it skill folders already own. */
interface EmitRoots {
  /** Absolute `<destDir>/.opencode`. */
  readonly opencodeDir: string;
  /** Absolute `<destDir>/.opencode/skills/lisa` (skill-owned). */
  readonly skillsDir: string;
}

/**
 * Copy every shared module the bundled skills import from outside their skill
 * folders into the emitted tree.
 * @param bundled - Bundled skills being emitted this run.
 * @param roots - Emit roots for this host project.
 * @returns Emitted paths, relative to `.opencode/`, sorted.
 */
export async function emitSharedScripts(
  bundled: readonly BundledSkillSource[],
  roots: EmitRoots
): Promise<readonly string[]> {
  const seeds: readonly PendingModule[] = bundled.flatMap(source =>
    source.files.filter(isScriptModule).map(file => ({
      sourcePath: path.join(source.sourceDir, file),
      emittedPath: path.join(roots.skillsDir, source.skillName, file),
      pluginRoot: pluginRootOf(source),
    }))
  );
  const modules = await collectSharedModules(seeds, new Map(), roots);
  await Promise.all(
    [...modules.values()].map(async module => {
      const destPath = path.join(roots.opencodeDir, module.emittedRelative);
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(module.sourcePath, destPath);
    })
  );
  return Object.freeze([...modules.keys()].sort((a, b) => a.localeCompare(b)));
}

/**
 * Follow relative imports breadth-first, collecting every target that lands
 * outside the skill-owned `skills/lisa/` subtree.
 * @param pending - Modules whose imports have not been followed yet.
 * @param found - Shared modules collected so far, keyed by emitted path.
 * @param roots - Emit roots for this host project.
 * @returns Every shared module reachable from `pending`, keyed by emitted path.
 */
async function collectSharedModules(
  pending: readonly PendingModule[],
  found: ReadonlyMap<string, SharedModule>,
  roots: EmitRoots
): Promise<ReadonlyMap<string, SharedModule>> {
  if (pending.length === 0) {
    return found;
  }
  const discovered = (
    await Promise.all(pending.map(module => escapingImports(module, roots)))
  ).flat();
  const merged = await mergeDiscovered(discovered, found);
  const next = [...merged.values()]
    .filter(module => !found.has(module.emittedRelative))
    .map(module => ({
      sourcePath: module.sourcePath,
      emittedPath: path.join(roots.opencodeDir, module.emittedRelative),
      pluginRoot: module.pluginRoot,
    }));
  return collectSharedModules(next, merged, roots);
}

/**
 * List the relative imports of one module that leave the skill-owned subtree.
 * @param module - Module to inspect.
 * @param roots - Emit roots for this host project.
 * @returns Shared modules this module needs emitted.
 */
async function escapingImports(
  module: PendingModule,
  roots: EmitRoots
): Promise<readonly SharedModule[]> {
  const imports = await resolveRelativeImports(module.sourcePath);
  const escaping = imports
    .map(({ specifier }) => ({
      specifier,
      emittedPath: path.resolve(path.dirname(module.emittedPath), specifier),
    }))
    .filter(entry => !isWithin(roots.skillsDir, entry.emittedPath));
  return Promise.all(
    escaping.map(entry =>
      toSharedModule(module, entry.specifier, entry.emittedPath, roots)
    )
  );
}

/**
 * Map one escaping import onto its plugin source, failing with a named error
 * when it would land outside the owned `.opencode/skills/scripts/` subtree
 * (the only one stale cleanup may delete from) or its source is missing.
 * @param module - Importing module.
 * @param specifier - The specifier as written.
 * @param emittedPath - Absolute path the specifier resolves to once emitted.
 * @param roots - Emit roots for this host project.
 * @returns The shared module to emit.
 */
async function toSharedModule(
  module: PendingModule,
  specifier: string,
  emittedPath: string,
  roots: EmitRoots
): Promise<SharedModule> {
  const sharedRoot = path.join(roots.opencodeDir, SHARED_ROOT_SUBDIR);
  const emittedRelative = toManifestPath(
    path.relative(roots.opencodeDir, emittedPath)
  );
  if (!emittedRelative.startsWith(SHARED_SCRIPTS_PREFIX)) {
    throw new Error(
      `OpenCode emit: ${module.sourcePath} imports "${specifier}", which resolves outside .opencode/${SHARED_SCRIPTS_PREFIX} once emitted`
    );
  }
  const sourcePath = path.join(
    module.pluginRoot,
    path.relative(sharedRoot, emittedPath)
  );
  if (!(await fse.pathExists(sourcePath))) {
    throw new Error(
      `OpenCode emit: ${module.sourcePath} imports "${specifier}" but ${sourcePath} does not exist`
    );
  }
  return { sourcePath, emittedRelative, pluginRoot: module.pluginRoot };
}

/**
 * Find the plugin root a bundled skill ships in. Skills live at
 * `plugins/<p>/skills/<n>/` or `plugins/<p>/.codex-plugin/skills/<n>/`; both
 * belong to `plugins/<p>/`, whose `scripts/` holds the shared modules.
 * @param source - Bundled skill source.
 * @returns Absolute plugin root.
 */
function pluginRootOf(source: BundledSkillSource): string {
  const skillsRootParent = path.dirname(path.dirname(source.sourceDir));
  return path.basename(skillsRootParent) === CODEX_PLUGIN_DIR
    ? path.dirname(skillsRootParent)
    : skillsRootParent;
}

/**
 * Merge newly discovered modules into the collected set, accepting a repeat
 * only when it is the same file or byte-identical content.
 * @param discovered - Modules found in this round.
 * @param found - Modules collected in earlier rounds.
 * @returns The merged set.
 */
async function mergeDiscovered(
  discovered: readonly SharedModule[],
  found: ReadonlyMap<string, SharedModule>
): Promise<ReadonlyMap<string, SharedModule>> {
  return discovered.reduce<Promise<ReadonlyMap<string, SharedModule>>>(
    async (accPromise, module) => {
      const acc = await accPromise;
      const existing = acc.get(module.emittedRelative);
      if (existing === undefined) {
        return new Map([...acc, [module.emittedRelative, module]]);
      }
      await assertSameModule(existing, module);
      return acc;
    },
    Promise.resolve(found)
  );
}

/**
 * Fail when two different source modules would land on one emitted path.
 * @param first - Module already claiming the path.
 * @param second - Module that would claim it too.
 */
async function assertSameModule(
  first: SharedModule,
  second: SharedModule
): Promise<void> {
  if (first.sourcePath === second.sourcePath) {
    return;
  }
  const [a, b] = await Promise.all([
    readFile(first.sourcePath),
    readFile(second.sourcePath),
  ]);
  if (!a.equals(b)) {
    throw new Error(
      `OpenCode emit: ${first.emittedRelative} would be written from two different modules: ${first.sourcePath} and ${second.sourcePath}`
    );
  }
}
