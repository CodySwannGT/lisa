/**
 * Install Lisa-bundled skills into a host project's `.codex/skills/lisa/`.
 *
 * Skills are the open Agent Skills format (SKILL.md + optional siblings).
 * Codex discovers them from the project config folder (`<destDir>/.codex/`)
 * via the loader at `codex-rs/core-skills/src/loader.rs`.
 *
 * What this installs:
 *   1. Lisa-bundled skill folders from `plugins/<p>/skills/<n>/` are copied
 *      verbatim to `.codex/skills/lisa/<n>/`.
 *   2. Lisa commands (e.g., `plugins/lisa/commands/fix.md`) are converted
 *      to skills since Codex has no first-class slash-command extension
 *      point. A command at `commands/jira/create.md` becomes a skill named
 *      `lisa-jira-create` invocable via `$lisa-jira-create`.
 *
 * The lisa-namespace prefix ensures Lisa's commands-as-skills don't collide
 * with same-named skills (e.g., Lisa's `fix.md` command + Lisa's existing
 * `fix` skill if one ever existed).
 * @module codex/skills-installer
 */
import * as fse from "fs-extra";
import yaml from "js-yaml";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";

/** Subdirectory inside `.codex/skills/` where Lisa-owned skills live */
export const LISA_SKILLS_SUBDIR = path.join("skills", "lisa");

/** Prefix applied to Lisa command-as-skill names */
export const LISA_COMMAND_SKILL_PREFIX = "lisa-";

/** Filename of the skill manifest at the root of every skill folder */
const SKILL_MD_FILENAME = "SKILL.md";

/** Result of one skill copy */
export interface InstalledSkill {
  /** Skill name (matches the SKILL.md `name` frontmatter) */
  readonly name: string;
  /** Source kind: bundled skill folder or generated from command */
  readonly source: "bundled" | "command";
  /** Path written, relative to `.codex/` */
  readonly relativePath: string;
}

/** Aggregated result */
export interface SkillsInstallResult {
  readonly installed: readonly InstalledSkill[];
  readonly managedFiles: readonly string[];
  /** Skill directories deleted because Lisa stopped shipping them */
  readonly deleted: readonly string[];
}

/**
 * Install all Lisa-bundled skills + command-derived skills.
 *
 * Stale skills (in the previous manifest but no longer in Lisa's catalog)
 * are deleted from `.codex/skills/lisa/` so renames in the source tree
 * don't leave orphan directories behind.
 * @param lisaDir - Absolute path to the Lisa repo root
 * @param destDir - Absolute path to the host project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.codex/`); used to detect stale skill directories
 * @returns Result describing installed skills + managed files + deletions
 */
export async function installSkills(
  lisaDir: string,
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<SkillsInstallResult> {
  const skillsDir = path.join(destDir, ".codex", LISA_SKILLS_SUBDIR);
  await fse.ensureDir(skillsDir);

  // Step 1: bundled skills
  const bundled = await discoverBundledSkills(lisaDir);
  const bundledInstalls = await Promise.all(
    bundled.map(source => copyBundledSkill(source, skillsDir))
  );
  const bundledFiles = bundled.flatMap(source =>
    source.files.map(file =>
      path.join(LISA_SKILLS_SUBDIR, source.skillName, file)
    )
  );

  // Step 2: command-as-skill conversions
  const commandSkills = await discoverLisaCommands(lisaDir);
  const commandInstalls = await Promise.all(
    commandSkills.map(cmd => emitCommandAsSkill(cmd, skillsDir))
  );
  const commandFiles = commandInstalls.map(install =>
    path.join(LISA_SKILLS_SUBDIR, install.name, SKILL_MD_FILENAME)
  );

  const installed: readonly InstalledSkill[] = [
    ...bundledInstalls,
    ...commandInstalls,
  ];

  // Step 3: delete stale skill directories
  const deleted = await deleteStaleSkills(
    previousManagedFiles,
    new Set(installed.map(s => s.name)),
    destDir
  );

  return {
    installed: Object.freeze(installed),
    managedFiles: Object.freeze([...bundledFiles, ...commandFiles]),
    deleted: Object.freeze(deleted),
  };
}

/**
 * Delete skill directories that were Lisa-managed last run but aren't
 * shipped this run. Identifies skill names from the previous manifest by
 * looking for paths inside `.codex/skills/lisa/<name>/...`.
 *
 * Whole directories are removed (not individual files) so siblings the host
 * accidentally added inside a Lisa skill folder also disappear — Lisa owns
 * the directory boundary, not just specific files.
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.codex/`)
 * @param currentSkillNames - Skill names Lisa is shipping this run
 * @param destDir - Absolute path to the host project root
 * @returns Sorted list of stale skill names that were deleted
 */
async function deleteStaleSkills(
  previousManagedFiles: readonly string[],
  currentSkillNames: ReadonlySet<string>,
  destDir: string
): Promise<readonly string[]> {
  const lisaSkillsPrefix = `${LISA_SKILLS_SUBDIR}${path.sep}`;
  const previousSkillNames = extractPreviousSkillNames(
    previousManagedFiles,
    lisaSkillsPrefix
  );
  const stale = previousSkillNames.filter(name => !currentSkillNames.has(name));
  await Promise.all(
    stale.map(async name => {
      const absPath = path.join(destDir, ".codex", LISA_SKILLS_SUBDIR, name);
      if (await fse.pathExists(absPath)) {
        await rm(absPath, { recursive: true, force: true });
      }
    })
  );
  return Object.freeze([...stale].sort((a, b) => a.localeCompare(b)));
}

/**
 * Pick the unique skill-folder names out of the previous manifest's file
 * list — every path inside `.codex/skills/lisa/<name>/...` contributes
 * `<name>` to the result.
 * @param previousManagedFiles - Files Lisa managed on the previous run
 * @param lisaSkillsPrefix - The path prefix that identifies Lisa skill files
 * @returns Unique skill names extracted from those paths
 */
function extractPreviousSkillNames(
  previousManagedFiles: readonly string[],
  lisaSkillsPrefix: string
): readonly string[] {
  const names = previousManagedFiles
    .filter(file => file.startsWith(lisaSkillsPrefix))
    .map(file => file.slice(lisaSkillsPrefix.length).split(path.sep)[0])
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names));
}

/** A single discovered bundled-skill folder source */
interface BundledSkillSource {
  readonly skillName: string;
  readonly sourceDir: string;
  readonly files: readonly string[];
}

/**
 * Walk `plugins/<plugin>/skills/<name>/` discovering each skill folder.
 * De-duplicates by skill name with stack-specific plugins winning over the
 * base `lisa` plugin: `lisa` is processed first, all other plugins sorted
 * alphabetically after, and the Map dedup is last-wins so any non-base plugin
 * overrides base entries regardless of its name's sort position.
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @returns De-duplicated bundled-skill sources, sorted by skill name
 */
async function discoverBundledSkills(
  lisaDir: string
): Promise<readonly BundledSkillSource[]> {
  const pluginsDir = path.join(lisaDir, "plugins");
  if (!(await fse.pathExists(pluginsDir))) {
    return [];
  }
  // Put base `lisa` first so any other plugin (stack-specific or third-party)
  // comes after in the flat array. Map dedup below is last-wins, so
  // stack-specific entries always override base entries regardless of how
  // the non-base plugin names sort alphabetically.
  const all = (await readdir(pluginsDir)).filter(name => name !== "src");
  const plugins = [
    ...all.filter(n => n === "lisa"),
    ...all.filter(n => n !== "lisa").sort((a, b) => a.localeCompare(b)),
  ];
  const candidatesByPlugin = await Promise.all(
    plugins.map(pluginName => discoverSkillsInPlugin(pluginsDir, pluginName))
  );
  // Plugin iteration order: base first, stack-specific last.
  // Map dedup is last-wins, so stack-specific entries override the base.
  const flat = candidatesByPlugin.flat();
  const deduped = Array.from(
    new Map(flat.map(source => [source.skillName, source])).values()
  );
  return Object.freeze(
    [...deduped].sort((a, b) => a.skillName.localeCompare(b.skillName))
  );
}

/**
 * Discover every skill directory under one plugin's `skills/` folder. Skips
 * any non-directory entries (defensive against stray .DS_Store and similar).
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`
 * @param pluginName - Plugin directory name (e.g. "lisa", "lisa-rails")
 * @returns Bundled-skill sources discovered in this plugin (file order)
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
 * Recursively list all file paths under `root` as relative paths. Pure
 * recursion (no mutable accumulator) so the result is referentially clean.
 * @param root - Absolute path to the directory to walk
 * @returns Relative paths of every regular file under `root`
 */
async function listFilesRecursive(root: string): Promise<readonly string[]> {
  return walkDir(root, "");
}

/**
 * Recursive helper for listFilesRecursive. The relative path is threaded
 * down so nested files come back as `subdir/file.ext` etc.
 * @param root - Absolute path to the directory to walk
 * @param rel - Path under `root` we're currently visiting (relative)
 * @returns Relative paths of every regular file at or below `root/rel`
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

/**
 * Copy one bundled skill folder verbatim into the host's `.codex/skills/lisa/`.
 * @param source - Bundled-skill source to copy
 * @param skillsDir - Absolute path to `<destDir>/.codex/skills/lisa/`
 * @returns Result describing the installed skill
 */
async function copyBundledSkill(
  source: BundledSkillSource,
  skillsDir: string
): Promise<InstalledSkill> {
  const destSkillDir = path.join(skillsDir, source.skillName);
  await fse.ensureDir(destSkillDir);
  await Promise.all(
    source.files.map(async file => {
      const srcPath = path.join(source.sourceDir, file);
      const destPath = path.join(destSkillDir, file);
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    })
  );
  return {
    name: source.skillName,
    source: "bundled",
    relativePath: path.join(LISA_SKILLS_SUBDIR, source.skillName),
  };
}

/** A discovered Lisa command source to be converted into a skill */
interface LisaCommandSource {
  readonly skillName: string;
  readonly sourcePath: string;
  /** Original path components for description (e.g., "lisa:jira:create") */
  readonly displayName: string;
}

/**
 * Walk `plugins/<plugin>/commands/**\/*.md` discovering each command file.
 * Nested directories produce dash-joined skill names: `commands/git/commit.md`
 * → `lisa-git-commit`.
 *
 * De-duplicates by final skill name with stack-specific plugins winning over
 * the base `lisa` plugin (same base-first ordering as discoverBundledSkills).
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @returns De-duplicated command-derived skill sources, sorted by skill name
 */
async function discoverLisaCommands(
  lisaDir: string
): Promise<readonly LisaCommandSource[]> {
  const pluginsDir = path.join(lisaDir, "plugins");
  if (!(await fse.pathExists(pluginsDir))) {
    return [];
  }
  // Put base `lisa` first so any other plugin (stack-specific or third-party)
  // comes after in the flat array. Map dedup below is last-wins, so
  // stack-specific entries always override base entries regardless of how
  // the non-base plugin names sort alphabetically.
  const all = (await readdir(pluginsDir)).filter(name => name !== "src");
  const plugins = [
    ...all.filter(n => n === "lisa"),
    ...all.filter(n => n !== "lisa").sort((a, b) => a.localeCompare(b)),
  ];
  const candidatesByPlugin = await Promise.all(
    plugins.map(pluginName => discoverCommandsInPlugin(pluginsDir, pluginName))
  );
  // Plugin iteration order: base first, stack-specific last.
  // Map dedup is last-wins, so stack-specific entries override the base.
  const flat = candidatesByPlugin.flat();
  const deduped = Array.from(
    new Map(flat.map(source => [source.skillName, source])).values()
  );
  return Object.freeze(
    [...deduped].sort((a, b) => a.skillName.localeCompare(b.skillName))
  );
}

/**
 * Discover every Markdown command file under one plugin's `commands/`
 * folder, turning each into a LisaCommandSource. Returns [] if the plugin
 * has no commands directory.
 * @param pluginsDir - Absolute path to `<lisaDir>/plugins`
 * @param pluginName - Plugin directory name
 * @returns Command sources discovered in this plugin (file order)
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
      const skillName = `${LISA_COMMAND_SKILL_PREFIX}${segments.join("-")}`;
      return {
        skillName,
        sourcePath: path.join(commandsRoot, relFile),
        displayName: `lisa:${segments.join(":")}`,
      };
    });
}

/**
 * Convert a Lisa command Markdown file into a Codex skill.
 *
 * The command's frontmatter (description) becomes the skill description.
 * The command body becomes the skill body, with `$ARGUMENTS` removed since
 * skills don't have CLI argument substitution — the user's natural-language
 * input flows in via the surrounding conversation.
 * @param cmd - Discovered command source
 * @param skillsDir - Absolute path to `<destDir>/.codex/skills/lisa/`
 * @returns Result describing the installed (command-derived) skill
 */
async function emitCommandAsSkill(
  cmd: LisaCommandSource,
  skillsDir: string
): Promise<InstalledSkill> {
  const sourceContent = await readFile(cmd.sourcePath, "utf8");
  const skillContent = convertCommandToSkill(
    sourceContent,
    cmd.skillName,
    cmd.displayName
  );
  const destSkillDir = path.join(skillsDir, cmd.skillName);
  await fse.ensureDir(destSkillDir);
  await writeFile(
    path.join(destSkillDir, SKILL_MD_FILENAME),
    skillContent,
    "utf8"
  );
  return {
    name: cmd.skillName,
    source: "command",
    relativePath: path.join(LISA_SKILLS_SUBDIR, cmd.skillName),
  };
}

/**
 * Pure transform: convert a Lisa command markdown to a Codex skill markdown.
 *
 * Preserves the description from the command's frontmatter; strips the
 * `argument-hint` field (no analog in skills); strips `$ARGUMENTS`
 * substitution markers from the body.
 * @param commandSource - Raw contents of the command .md file
 * @param skillName - Target skill name (already includes the `lisa-` prefix)
 * @param displayName - Human-readable name used as a fallback description
 * @returns The Codex skill SKILL.md content as a string
 */
export function convertCommandToSkill(
  commandSource: string,
  skillName: string,
  displayName: string
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(
    commandSource
  );
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Command source is missing YAML frontmatter for ${displayName}`
    );
  }
  const rawFrontmatter = match[1];
  const rawBody = match[2];

  // Parse the frontmatter properly so we get YAML-correct value extraction
  // (handles quoting, escapes, multiline forms — all of which a hand-rolled
  // regex would get wrong on adversarial input).
  const parsedFrontmatter = yaml.load(rawFrontmatter);
  const description = extractDescription(parsedFrontmatter, displayName);

  const body = rawBody
    .trimStart()
    .replace(/\$ARGUMENTS\s*/g, "")
    .trimEnd();

  const frontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${body}\n`;
}

/**
 * Pull the `description` field out of a parsed YAML frontmatter mapping,
 * falling back to `displayName` if it's missing or not a string.
 * @param parsed - Output of `yaml.load(rawFrontmatter)` (untrusted shape)
 * @param displayName - Fallback used when no description is available
 * @returns The description string to embed in the skill frontmatter
 */
function extractDescription(parsed: unknown, displayName: string): string {
  if (parsed === null || typeof parsed !== "object") {
    return displayName;
  }
  const value = (parsed as Record<string, unknown>).description;
  return typeof value === "string" && value.length > 0 ? value : displayName;
}
