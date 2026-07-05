/**
 * Agent-agnostic discovery of Lisa-bundled skill and command sources.
 *
 * Both the Codex overlay (`src/codex/skills-installer.ts`) and the OpenCode
 * overlay (`src/opencode/skills-installer.ts`) install skills into a host
 * project's per-agent config folder (`.codex/skills/lisa/`,
 * `.opencode/skills/lisa/`). The *discovery* half — walking
 * `plugins/<plugin>/skills/` and `plugins/<plugin>/commands/`, de-duplicating
 * across plugins, and applying the maintainer-only denylist — is identical for
 * every agent. It lives here so the per-agent installers share one source of
 * truth and can't drift apart.
 *
 * Discovery is pure with respect to the destination: it only reads from the
 * Lisa package's `plugins/` tree and returns source descriptors. The copy /
 * stale-cleanup / target-directory logic stays in each per-agent installer,
 * because that is where the agents genuinely differ.
 * @module core/lisa-skill-sources
 */
import * as fse from "fs-extra";
import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";

/** Prefix applied to Lisa command-as-skill names (e.g. `lisa-git-commit`). */
export const LISA_COMMAND_SKILL_PREFIX = "lisa-";

/** Prefix applied to Lisa command display names (e.g. `lisa:git:commit`). */
export const LISA_COMMAND_DISPLAY_PREFIX = "lisa:";

/**
 * Suffixes that mark a plugin directory as a per-harness fanout VARIANT rather
 * than a canonical source. Lisa generates `<plugin>-agy`, `<plugin>-copilot`,
 * and `<plugin>-cursor` variants from the canonical `<plugin>` for those
 * harnesses (see the stack-per-agent fanout). They are reformatted copies — the
 * copilot variant even renames agents to `*.agent.md` — so an overlay that reads
 * the canonical Markdown format (Codex, OpenCode) must ingest the canonical
 * plugins, not these variants, or it ships duplicates / harness-specific copies.
 */
export const HARNESS_VARIANT_PLUGIN_SUFFIXES = [
  "-agy",
  "-copilot",
  "-cursor",
] as const;

/**
 * Predicate: is `pluginName` a per-harness fanout variant (agy/copilot/cursor)?
 * Canonical plugins (`lisa`, `lisa-typescript`, `lisa-wiki`, …) return false.
 * @param pluginName - Plugin directory name under `plugins/`.
 * @returns True when the plugin is a harness-specific variant, not a source.
 */
export function isHarnessVariantPlugin(pluginName: string): boolean {
  return HARNESS_VARIANT_PLUGIN_SUFFIXES.some(suffix =>
    pluginName.endsWith(suffix)
  );
}

/**
 * A plugin-name filter: given a plugin directory name, return true to include
 * it in discovery. Used to restrict an overlay to canonical (non-variant)
 * plugins.
 */
export type PluginFilter = (pluginName: string) => boolean;

/** A single discovered bundled-skill folder source. */
export interface BundledSkillSource {
  /** Skill name (matches the SKILL.md `name` frontmatter and folder name). */
  readonly skillName: string;
  /** Absolute path to the source skill folder. */
  readonly sourceDir: string;
  /** Relative file paths inside the skill folder (recursive). */
  readonly files: readonly string[];
}

/** A discovered Lisa command source to be converted into a skill. */
export interface LisaCommandSource {
  /** Final skill name including the `lisa-` prefix. */
  readonly skillName: string;
  /** Absolute path to the source command `.md` file. */
  readonly sourcePath: string;
  /** Original path components for display (e.g. "lisa:jira:create"). */
  readonly displayName: string;
}

/**
 * Load a skill distribution policy file that marks Lisa-maintainer-only skills
 * as non-distributable.
 *
 * Missing or malformed policy files fail open to an empty set so tests and
 * minimal package layouts remain usable.
 * @param lisaDir - Absolute path to the Lisa repo / installed package.
 * @param policyRelativePath - Path to the policy JSON, relative to `lisaDir`.
 * @returns Skill directory names that must not be installed into host projects.
 */
export async function loadSkillDenylist(
  lisaDir: string,
  policyRelativePath: string
): Promise<ReadonlySet<string>> {
  const policyPath = path.join(lisaDir, policyRelativePath);
  if (!(await fse.pathExists(policyPath))) {
    return new Set();
  }
  try {
    const raw = await readFile(policyPath, "utf8");
    const parsed = JSON.parse(raw) as { denylistedSkills?: unknown };
    if (!Array.isArray(parsed.denylistedSkills)) {
      return new Set();
    }
    return new Set(
      parsed.denylistedSkills.filter(
        (name): name is string => typeof name === "string"
      )
    );
  } catch {
    return new Set();
  }
}

/**
 * Walk `plugins/<plugin>/skills/<name>/` discovering each skill folder.
 *
 * De-duplicates by skill name with last-wins semantics: the base `lisa` plugin
 * is always processed first, then remaining plugins in alphabetical order, so
 * any stack-specific or third-party plugin overrides the base regardless of how
 * the name sorts.
 * @param lisaDir - Absolute path to the Lisa repo / installed package.
 * @param denylistedSkills - Skill names that must not ship to host projects.
 * @param pluginFilter - Optional predicate to restrict which plugin directories
 *   are walked. Defaults to including every plugin.
 * @returns De-duplicated bundled-skill sources, sorted by skill name.
 */
export async function discoverBundledSkills(
  lisaDir: string,
  denylistedSkills: ReadonlySet<string>,
  pluginFilter?: PluginFilter
): Promise<readonly BundledSkillSource[]> {
  const pluginsDir = path.join(lisaDir, "plugins");
  if (!(await fse.pathExists(pluginsDir))) {
    return [];
  }
  const plugins = await orderedPluginNames(pluginsDir, pluginFilter);
  const candidatesByPlugin = await Promise.all(
    plugins.map(pluginName => discoverSkillsInPlugin(pluginsDir, pluginName))
  );
  // Base-first iteration order + last-wins Map → stack-specific (and any
  // other non-base plugin) overrides base for duplicate skill names.
  const flat = candidatesByPlugin.flat();
  const deduped = Array.from(
    new Map(flat.map(source => [source.skillName, source])).values()
  );
  return Object.freeze(
    [...deduped]
      .filter(source => !denylistedSkills.has(source.skillName))
      .sort((a, b) => a.skillName.localeCompare(b.skillName))
  );
}

/**
 * Walk `plugins/<plugin>/commands/**\/*.md` discovering each command file.
 * Nested directories produce dash-joined skill names: `commands/git/commit.md`
 * → `lisa-git-commit`.
 *
 * De-duplicates by final skill name with last-wins semantics (base `lisa`
 * first, then remaining plugins alphabetically) so stack-specific plugins
 * override the base regardless of name sort order.
 * @param lisaDir - Absolute path to the Lisa repo / installed package.
 * @param pluginFilter - Optional predicate to restrict which plugin directories
 *   are walked (e.g. canonical-only for the OpenCode native command surface).
 *   Defaults to including every plugin.
 * @returns De-duplicated command-derived skill sources, sorted by skill name.
 */
export async function discoverLisaCommands(
  lisaDir: string,
  pluginFilter?: PluginFilter
): Promise<readonly LisaCommandSource[]> {
  const pluginsDir = path.join(lisaDir, "plugins");
  if (!(await fse.pathExists(pluginsDir))) {
    return [];
  }
  const plugins = await orderedPluginNames(pluginsDir, pluginFilter);
  const candidatesByPlugin = await Promise.all(
    plugins.map(pluginName => discoverCommandsInPlugin(pluginsDir, pluginName))
  );
  const flat = candidatesByPlugin.flat();
  const deduped = Array.from(
    new Map(flat.map(source => [source.skillName, source])).values()
  );
  return Object.freeze(
    [...deduped].sort((a, b) => a.skillName.localeCompare(b.skillName))
  );
}

/**
 * Strip a redundant leading `lisa` segment from nested command paths.
 * `commands/lisa/git/commit.md` and `commands/git/commit.md` both normalize to
 * `["git", "commit"]` so display/skill names stay `lisa:git:commit` /
 * `lisa-git-commit`.
 * @param segments - Command path without the `.md` extension.
 * @returns Segments with an optional leading `lisa` directory removed.
 */
export function normalizeLisaCommandSegments(
  segments: readonly string[]
): readonly string[] {
  return segments.length > 0 && segments[0] === "lisa"
    ? segments.slice(1)
    : segments;
}

/**
 * Convert command path segments into the cross-runtime skill alias.
 * @param segments - Command path without the `.md` extension.
 * @returns Hyphenated skill name, e.g. `["git", "commit"]` → `lisa-git-commit`.
 */
export function commandSegmentsToLisaSkillName(
  segments: readonly string[]
): string {
  const normalized = normalizeLisaCommandSegments(segments);
  return `${LISA_COMMAND_SKILL_PREFIX}${normalized.join("-")}`;
}

/**
 * Convert command path segments into the user-facing slash-command name.
 * @param segments - Command path without the `.md` extension.
 * @returns Colon-scoped command name, e.g. `["git", "commit"]` → `lisa:git:commit`.
 */
export function commandSegmentsToLisaDisplayName(
  segments: readonly string[]
): string {
  const normalized = normalizeLisaCommandSegments(segments);
  return `${LISA_COMMAND_DISPLAY_PREFIX}${normalized.join(":")}`;
}

/**
 * List the plugin directory names under `plugins/`, base-first then the rest
 * alphabetically, skipping the `src/` build-input tree.
 *
 * Base-first ordering is what gives the last-wins Map dedup its "stack
 * overrides base" behavior.
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`.
 * @param pluginFilter - Optional predicate to drop plugin directories before
 *   ordering (e.g. exclude per-harness variants). Defaults to including all.
 * @returns Ordered plugin directory names.
 */
async function orderedPluginNames(
  pluginsDir: string,
  pluginFilter?: PluginFilter
): Promise<readonly string[]> {
  const include = pluginFilter ?? (() => true);
  const all = (await readdir(pluginsDir)).filter(
    name => name !== "src" && include(name)
  );
  return [
    ...all.filter(n => n === "lisa"),
    ...all.filter(n => n !== "lisa").sort((a, b) => a.localeCompare(b)),
  ];
}

/**
 * Discover every skill directory under one plugin's `skills/` folder. Skips any
 * non-directory entries (defensive against stray .DS_Store and similar).
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`.
 * @param pluginName - Plugin directory name (e.g. "lisa", "lisa-rails").
 * @returns Bundled-skill sources discovered in this plugin (file order).
 */
async function discoverSkillsInPlugin(
  pluginsDir: string,
  pluginName: string
): Promise<readonly BundledSkillSource[]> {
  const skillsDir = path.join(pluginsDir, pluginName, "skills");
  if (!(await fse.pathExists(skillsDir))) {
    return [];
  }
  const skillNames = await readdir(skillsDir);
  const candidates = await Promise.all(
    skillNames.map(async skillName => {
      const sourceDir = path.join(skillsDir, skillName);
      const dirStat = await stat(sourceDir);
      if (!dirStat.isDirectory()) {
        return undefined;
      }
      const files = await listFilesRecursive(sourceDir);
      return { skillName, sourceDir, files } satisfies BundledSkillSource;
    })
  );
  return candidates.filter(
    (entry): entry is BundledSkillSource => entry !== undefined
  );
}

/**
 * Discover every Markdown command file under one plugin's `commands/` folder,
 * turning each into a LisaCommandSource. Returns [] if the plugin has no
 * commands directory.
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`.
 * @param pluginName - Plugin directory name.
 * @returns Command sources discovered in this plugin (file order).
 */
async function discoverCommandsInPlugin(
  pluginsDir: string,
  pluginName: string
): Promise<readonly LisaCommandSource[]> {
  const commandsRoot = path.join(pluginsDir, pluginName, "commands");
  if (!(await fse.pathExists(commandsRoot))) {
    return [];
  }
  const files = await listFilesRecursive(commandsRoot);
  return files
    .filter(relFile => relFile.endsWith(".md"))
    .map(relFile => {
      // commands/git/commit.md → ["git", "commit"]
      const segments = relFile.replace(/\.md$/, "").split(path.sep);
      return {
        skillName: commandSegmentsToLisaSkillName(segments),
        sourcePath: path.join(commandsRoot, relFile),
        displayName: commandSegmentsToLisaDisplayName(segments),
      };
    });
}

/**
 * Recursively list all file paths under `root` as relative paths. Pure
 * recursion (no mutable accumulator) so the result is referentially clean.
 * @param root - Absolute path to the directory to walk.
 * @returns Relative paths of every regular file under `root`.
 */
export async function listFilesRecursive(
  root: string
): Promise<readonly string[]> {
  return walkDir(root, "");
}

/**
 * Recursive helper for listFilesRecursive. The relative path is threaded down
 * so nested files come back as `subdir/file.ext` etc.
 * @param root - Absolute path to the directory to walk.
 * @param rel - Path under `root` we're currently visiting (relative).
 * @returns Relative paths of every regular file at or below `root/rel`.
 */
async function walkDir(root: string, rel: string): Promise<readonly string[]> {
  const abs = path.join(root, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  const childResults = await Promise.all(
    entries.map(entry => {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        return walkDir(root, childRel);
      }
      if (entry.isFile()) {
        return Promise.resolve([childRel] as readonly string[]);
      }
      return Promise.resolve([] as readonly string[]);
    })
  );
  return childResults.flat();
}
