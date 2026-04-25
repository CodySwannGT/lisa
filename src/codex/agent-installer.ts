/**
 * Install Lisa-bundled agents into a host project's
 * `.codex/agents/lisa/<name>.toml`.
 *
 * Pipeline per agent:
 *   1. Read the source `.md` from the Lisa plugin
 *   2. Transform Markdown + YAML frontmatter → Codex agent TOML
 *   3. Apply optional host override file from
 *      `.codex/agents/host-overrides/<name>.toml` (deep-merge, host wins on
 *      key conflicts to satisfy the customization use case)
 *   4. Write the result to `.codex/agents/lisa/<name>.toml`
 *
 * Stale agents (in the previous manifest but no longer shipped by Lisa) are
 * deleted from `.codex/agents/lisa/` so renames in the source tree don't
 * leave orphans behind.
 * @module codex/agent-installer
 */
import * as fse from "fs-extra";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { transformAgentMarkdownToToml } from "./agent-transformer.js";

/** Subdirectory inside `.codex/agents/` where Lisa-owned agents live */
export const LISA_AGENTS_SUBDIR = path.join("agents", "lisa");

/** Subdirectory inside `.codex/agents/` where host overrides live */
export const HOST_OVERRIDES_SUBDIR = path.join("agents", "host-overrides");

/** Discovered Lisa agent source */
export interface AgentSource {
  /** Stable identifier matching the source filename without extension */
  readonly id: string;
  /** Absolute path to the source `.md` file */
  readonly sourcePath: string;
  /** Plugin name the agent ships from (for diagnostics) */
  readonly pluginName: string;
}

/** Result of installing one agent */
export interface InstalledAgent {
  /** Agent id (filename basename) */
  readonly id: string;
  /** Path written, relative to the destination project's `.codex/` directory */
  readonly relativePath: string;
  /** Whether a host override file was applied */
  readonly overrideApplied: boolean;
}

/** Aggregated result of an install pass */
export interface AgentInstallResult {
  readonly installed: readonly InstalledAgent[];
  /** Stale agent files deleted from `.codex/agents/lisa/` (relative to `.codex/`) */
  readonly deleted: readonly string[];
  /** Files written, relative to `.codex/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
}

/**
 * Discover every agent shipped by every Lisa plugin under `lisaDir`.
 *
 * Looks at `<lisaDir>/plugins/<plugin>/agents/*.md`. Skips the
 * `plugins/src/` source tree (which is the build input — we want the built
 * output). De-duplicates by agent id, with first-wins precedence so that
 * stack-specific overrides (e.g. `lisa-rails/agents/ops-specialist.md`) win
 * over the base `lisa/agents/ops-specialist.md` if both exist.
 * @param lisaDir - Absolute path to the Lisa repo root
 * @returns De-duplicated agent sources, sorted by id
 */
export async function discoverLisaAgents(
  lisaDir: string
): Promise<readonly AgentSource[]> {
  const pluginsDir = path.join(lisaDir, "plugins");
  if (!(await fse.pathExists(pluginsDir))) {
    return [];
  }
  const plugins = (await readdir(pluginsDir)).filter(name => name !== "src");
  const candidatesByPlugin = await Promise.all(
    plugins.map(pluginName => discoverAgentsInPlugin(pluginsDir, pluginName))
  );
  // Plugin order = directory order; first-wins on duplicate id
  const flat = candidatesByPlugin.flat();
  const deduped = Array.from(
    new Map(flat.map(source => [source.id, source])).values()
  );
  return Object.freeze([...deduped].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * List every `.md` file under one plugin's `agents/` directory and turn each
 * into an AgentSource. Returns [] if the plugin has no agents directory.
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`
 * @param pluginName - Plugin directory name (e.g. "lisa", "lisa-rails")
 * @returns Agent sources discovered in this plugin (file order)
 */
async function discoverAgentsInPlugin(
  pluginsDir: string,
  pluginName: string
): Promise<readonly AgentSource[]> {
  const agentsDir = path.join(pluginsDir, pluginName, "agents");
  if (!(await fse.pathExists(agentsDir))) {
    return [];
  }
  const files = (await readdir(agentsDir)).filter(f => f.endsWith(".md"));
  return files.map(file => ({
    id: file.replace(/\.md$/, ""),
    sourcePath: path.join(agentsDir, file),
    pluginName,
  }));
}

/**
 * Install all discovered agents into `<destDir>/.codex/agents/lisa/`.
 *
 * Returns a result describing what was written and what stale files were
 * deleted, so the caller can update the Lisa-managed manifest.
 * @param sources - Agent sources from discoverLisaAgents
 * @param destDir - Absolute path to the destination project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.codex/`); used to detect stale agents to delete
 * @returns Result describing installed/deleted/managedFiles
 */
export async function installAgents(
  sources: readonly AgentSource[],
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<AgentInstallResult> {
  const lisaAgentsDir = path.join(destDir, ".codex", LISA_AGENTS_SUBDIR);
  const overridesDir = path.join(destDir, ".codex", HOST_OVERRIDES_SUBDIR);
  await fse.ensureDir(lisaAgentsDir);

  // Each install is independent — run them sequentially to keep filesystem
  // ordering deterministic for snapshot tests, but build the result list
  // immutably via map (no .push).
  const installed: readonly InstalledAgent[] = await sequentialMap(
    sources,
    source => installSingleAgent(source, lisaAgentsDir, overridesDir)
  );
  const managedFiles: readonly string[] = installed.map(
    agent => agent.relativePath
  );

  const deleted = await deleteStaleAgents(
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
 * Map an async function over an array sequentially (one at a time), so
 * filesystem operations don't race. Equivalent to a for-await loop that
 * returns the accumulated results without mutating an interim array.
 * @param items - Input items
 * @param fn - Async transform applied to each item in turn
 * @returns The transformed values in input order
 */
async function sequentialMap<T, U>(
  items: readonly T[],
  fn: (item: T) => Promise<U>
): Promise<readonly U[]> {
  return items.reduce<Promise<readonly U[]>>(
    async (accPromise, item) => [...(await accPromise), await fn(item)],
    Promise.resolve([])
  );
}

/**
 * Transform + (optionally) merge override + write a single agent file.
 * @param source - Discovered agent source (id, plugin, source path)
 * @param lisaAgentsDir - Absolute path to `.codex/agents/lisa/` in the host
 * @param overridesDir - Absolute path to `.codex/agents/host-overrides/`
 * @returns Result describing the installed file (path, override applied?)
 */
async function installSingleAgent(
  source: AgentSource,
  lisaAgentsDir: string,
  overridesDir: string
): Promise<InstalledAgent> {
  const sourceContent = await readFile(source.sourcePath, "utf8");
  const baseToml = transformAgentMarkdownToToml(sourceContent);

  const overridePath = path.join(overridesDir, `${source.id}.toml`);
  const hasOverride = await fse.pathExists(overridePath);
  const finalToml = hasOverride
    ? await mergeOverride(baseToml, overridePath)
    : baseToml;

  const destFile = path.join(lisaAgentsDir, `${source.id}.toml`);
  await writeFile(destFile, finalToml, "utf8");

  return {
    id: source.id,
    relativePath: path.join(LISA_AGENTS_SUBDIR, `${source.id}.toml`),
    overrideApplied: hasOverride,
  };
}

/**
 * Deep-merge a host override TOML on top of Lisa's generated TOML.
 *
 * Host wins on key conflicts. Used so a host can swap `sandbox_mode`,
 * tweak `description`, or extend `nickname_candidates` for a Lisa agent
 * without forking the agent definition.
 * @param baseToml - Lisa-generated TOML to use as the base
 * @param overridePath - Absolute path to the host's override TOML file
 * @returns The merged TOML serialized back to a string
 */
async function mergeOverride(
  baseToml: string,
  overridePath: string
): Promise<string> {
  const overrideContent = await readFile(overridePath, "utf8");
  const base = parseToml(baseToml) as Record<string, unknown>;
  const override = parseToml(overrideContent) as Record<string, unknown>;
  const merged = deepMerge(base, override);
  return `${stringifyToml(merged)}\n`;
}

/**
 * Recursive object merge with override-wins semantics. Arrays are replaced
 * (not concatenated) to keep behavior predictable.
 * @param base - Lower-precedence object (Lisa-generated TOML, parsed)
 * @param override - Higher-precedence object (host override, parsed)
 * @returns A new merged record (input objects are not modified)
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  return Object.entries(override).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      const baseValue = acc[key];
      const bothMergeableObjects =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        baseValue !== null &&
        typeof baseValue === "object" &&
        !Array.isArray(baseValue);
      const nextValue = bothMergeableObjects
        ? deepMerge(
            baseValue as Record<string, unknown>,
            value as Record<string, unknown>
          )
        : value;
      return { ...acc, [key]: nextValue };
    },
    { ...base }
  );
}

/**
 * Delete files that were Lisa-managed last run but aren't shipped this run.
 * Only deletes files inside `.codex/agents/lisa/` to avoid touching anything
 * the host might be relying on.
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.codex/`)
 * @param currentManagedFiles - Files Lisa is shipping this run (relative
 *   to `.codex/`)
 * @param destDir - Absolute path to the host project root
 * @returns The list of relative paths that were deleted
 */
async function deleteStaleAgents(
  previousManagedFiles: readonly string[],
  currentManagedFiles: readonly string[],
  destDir: string
): Promise<readonly string[]> {
  const currentSet = new Set(currentManagedFiles);
  const lisaAgentsPrefix = `${LISA_AGENTS_SUBDIR}${path.sep}`;
  const stale = previousManagedFiles.filter(
    file => !currentSet.has(file) && file.startsWith(lisaAgentsPrefix)
  );
  await Promise.all(
    stale.map(async file => {
      const absPath = path.join(destDir, ".codex", file);
      if (await fse.pathExists(absPath)) {
        await unlink(absPath);
      }
    })
  );
  return Object.freeze(stale);
}
