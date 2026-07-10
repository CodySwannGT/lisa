/**
 * Reconcile the selected Lisa skill catalog exposed by repository plugins.
 *
 * The repository marketplace is Codex's only native skill delivery path. This
 * module counts the selected, deduplicated catalog and removes obsolete router
 * and link artifacts from older Lisa versions.
 * @module codex/skills-installer
 */
import { rm } from "node:fs/promises";
import * as path from "node:path";
import {
  discoverBundledSkills,
  loadSkillDenylist,
} from "../core/lisa-skill-sources.js";
import type { ProjectType } from "../core/config.js";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../core/lisa-plugin-selection.js";

export { convertCommandToSkill } from "./command-skill-transformer.js";
export { LISA_COMMAND_SKILL_PREFIX } from "../core/lisa-skill-sources.js";

/** Subdirectory inside `.codex/skills/` wholly owned by Lisa. */
export const LISA_SKILLS_SUBDIR = path.join("skills", "lisa");

/** Retired router catalog removed during reconciliation. */
const LEGACY_LIBRARY_SUBDIR = "lisa-library";
const INTERNAL_CODEX_SKILL_POLICY_RELATIVE_PATH = path.join(
  "scripts",
  "internal-codex-skill-policy.json"
);

/** Result of cataloging one plugin skill. */
export interface InstalledSkill {
  readonly name: string;
  readonly source: "bundled";
  /** Plugin source path relative to the Lisa package root. */
  readonly relativePath: string;
}

/** Aggregated result of project skill reconciliation. */
export interface SkillsInstallResult {
  readonly installed: readonly InstalledSkill[];
  readonly managedFiles: readonly string[];
  readonly deleted: readonly string[];
  readonly modelVisible: number;
}

/**
 * Catalog the applicable base, stack, and configured-feature plugin skills.
 * Exact duplicate names are resolved by shared base-first/stack-last discovery.
 * @param lisaDir Lisa repository or installed package root.
 * @param destDir Host project root.
 * @param previousManagedFiles Previous `.codex` ownership manifest entries.
 * @param detectedTypes Expanded detected project types.
 * @returns Selected plugin catalog and legacy cleanup metadata.
 */
export async function installSkills(
  lisaDir: string,
  destDir: string,
  previousManagedFiles: readonly string[],
  detectedTypes: readonly ProjectType[] = []
): Promise<SkillsInstallResult> {
  const codexDir = path.join(destDir, ".codex");
  const skillsDir = path.join(codexDir, LISA_SKILLS_SUBDIR);
  const selectedPlugins = await selectProjectLisaPlugins(
    destDir,
    detectedTypes
  );
  const denylistedSkills = await loadSkillDenylist(
    lisaDir,
    INTERNAL_CODEX_SKILL_POLICY_RELATIVE_PATH
  );
  const bundled = await discoverBundledSkills(
    lisaDir,
    denylistedSkills,
    projectPluginFilter(selectedPlugins)
  );

  const previousNames = extractPreviousSkillNames(previousManagedFiles);
  const deleted = [...previousNames].sort((left, right) =>
    left.localeCompare(right)
  );

  await Promise.all([
    rm(skillsDir, { force: true, recursive: true }),
    rm(path.join(codexDir, LEGACY_LIBRARY_SUBDIR), {
      force: true,
      recursive: true,
    }),
  ]);
  const installed = bundled.map(source => ({
    name: source.skillName,
    source: "bundled" as const,
    relativePath: path.relative(lisaDir, source.sourceDir),
  }));

  return {
    installed: Object.freeze(installed),
    managedFiles: Object.freeze([]),
    deleted: Object.freeze(deleted),
    modelVisible: installed.length,
  };
}

/**
 * Extract previously managed native skill directory names.
 * @param previousManagedFiles Previous `.codex` ownership entries.
 * @returns Unique previous skill directory names.
 */
function extractPreviousSkillNames(
  previousManagedFiles: readonly string[]
): readonly string[] {
  const prefix = `${LISA_SKILLS_SUBDIR}${path.sep}`;
  return Array.from(
    new Set(
      previousManagedFiles
        .filter(file => file.startsWith(prefix))
        .map(file => file.slice(prefix.length).split(path.sep)[0])
        .filter((name): name is string => Boolean(name) && name !== "SKILL.md")
    )
  );
}
