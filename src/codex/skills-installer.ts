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
 *
 * Source discovery (walking the plugin tree, dedup, denylist) is shared with
 * the OpenCode overlay via `core/lisa-skill-sources`; only the copy/stale/
 * target-directory logic is Codex-specific and lives here.
 * @module codex/skills-installer
 */
import * as fse from "fs-extra";
import { mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type BundledSkillSource,
  type LisaCommandSource,
  discoverBundledSkills,
  discoverLisaCommands,
  loadSkillDenylist,
} from "../core/lisa-skill-sources.js";
import { convertCommandToSkill } from "./command-skill-transformer.js";

export { convertCommandToSkill } from "./command-skill-transformer.js";
export { LISA_COMMAND_SKILL_PREFIX } from "../core/lisa-skill-sources.js";

/** Subdirectory inside `.codex/skills/` where Lisa-owned skills live */
export const LISA_SKILLS_SUBDIR = path.join("skills", "lisa");

/** Filename of the skill manifest at the root of every skill folder */
const SKILL_MD_FILENAME = "SKILL.md";

/** Path to the Codex skill distribution policy, relative to the Lisa root */
const INTERNAL_CODEX_SKILL_POLICY_RELATIVE_PATH = path.join(
  "scripts",
  "internal-codex-skill-policy.json"
);

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
  const denylistedSkills = await loadSkillDenylist(
    lisaDir,
    INTERNAL_CODEX_SKILL_POLICY_RELATIVE_PATH
  );

  // Step 1: bundled skills
  const bundled = await discoverBundledSkills(lisaDir, denylistedSkills);
  const bundledInstalls = await Promise.all(
    bundled.map(source => copyBundledSkill(source, skillsDir))
  );
  const bundledFiles = bundled.flatMap(source =>
    source.files.map(file =>
      path.join(LISA_SKILLS_SUBDIR, source.skillName, file)
    )
  );

  // Step 2: command-as-skill conversions (skip when the bundled skill already
  // owns the target name — e.g. `lisa-implement` ships as a bundled skill, so
  // the thin command wrapper would only duplicate it on Codex).
  const bundledSkillNames = new Set(bundled.map(source => source.skillName));
  const commandSkills = (await discoverLisaCommands(lisaDir)).filter(
    cmd => !bundledSkillNames.has(cmd.skillName)
  );
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

/**
 * Convert a Lisa command Markdown file into a Codex skill.
 *
 * The command's frontmatter becomes skill metadata plus a compatibility note.
 * The command body becomes the skill body, with `$ARGUMENTS` replaced by an
 * explicit instruction to use the user's surrounding request as arguments.
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
