/**
 * Mirror Lisa rule Markdown files into a harness-owned host directory.
 *
 * Lisa plugins split rules into:
 * - `rules/eager/` for always-loaded operational guidance.
 * - `rules/reference/` for larger bodies loaded on demand by breadcrumbs.
 *
 * Harness installers can copy the same source tree into their own managed
 * config directory and then point their native instruction mechanism at it.
 * @module core/lisa-rules-mirror
 */
import * as fse from "fs-extra";
import { copyFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import type { ProjectType } from "./config.js";

/** Subdirectories under each plugin's rules/ that carry rule .md files. */
const RULE_SUBDIRS = ["eager", "reference"] as const;

/** One rule file slated for mirroring, with the destination-relative path. */
type RuleFileEntry = {
  readonly absSource: string;
  readonly relPath: string;
};

/**
 * Copy every .md file from Lisa's base and detected stack plugin `rules/`
 * directories into a harness-owned rules directory, preserving the
 * `eager/` and `reference/` subdir structure.
 * @param lisaDir - Absolute path to the Lisa repo / installed package.
 * @param rulesDestDir - Absolute path to the harness-owned rules directory.
 * @param detectedTypes - Project types Lisa detected for the host.
 * @returns Relative paths (subdir/file or file) of every rule .md file copied.
 */
export async function mirrorLisaRules(
  lisaDir: string,
  rulesDestDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<readonly string[]> {
  const pluginNames = ["lisa", ...detectedTypes.map(type => `lisa-${type}`)];

  const filesByPlugin = await Promise.all(
    pluginNames.map(async pluginName => {
      const rulesRoot = path.join(lisaDir, "plugins", pluginName, "rules");
      if (!(await fse.pathExists(rulesRoot))) {
        return { entries: [] as readonly RuleFileEntry[] };
      }

      const subdirEntriesByDir = await Promise.all(
        RULE_SUBDIRS.map(async sub => {
          const subDir = path.join(rulesRoot, sub);
          if (!(await fse.pathExists(subDir))) {
            return [] as readonly RuleFileEntry[];
          }
          const subFiles = (await readdir(subDir)).filter(name =>
            name.endsWith(".md")
          );
          return subFiles.map<RuleFileEntry>(file => ({
            absSource: path.join(subDir, file),
            relPath: path.join(sub, file),
          }));
        })
      );

      const rootChildren = await readdir(rulesRoot, { withFileTypes: true });
      const flatEntries: readonly RuleFileEntry[] = rootChildren
        .filter(d => d.isFile() && d.name.endsWith(".md"))
        .map<RuleFileEntry>(d => ({
          absSource: path.join(rulesRoot, d.name),
          relPath: d.name,
        }));

      return { entries: [...subdirEntriesByDir.flat(), ...flatEntries] };
    })
  );

  const allRelPaths = filesByPlugin.flatMap(({ entries }) =>
    entries.map(e => e.relPath)
  );
  if (new Set(allRelPaths).size !== allRelPaths.length) {
    const duplicate = allRelPaths.find(
      (name, index) => allRelPaths.indexOf(name) !== index
    );
    throw new Error(
      `Duplicate Lisa rule path "${duplicate ?? "unknown"}" across plugin rules/ directories`
    );
  }

  await Promise.all(
    RULE_SUBDIRS.map(sub => fse.ensureDir(path.join(rulesDestDir, sub)))
  );

  await Promise.all(
    filesByPlugin.flatMap(({ entries }) =>
      entries.map(entry =>
        copyFile(entry.absSource, path.join(rulesDestDir, entry.relPath))
      )
    )
  );

  return Object.freeze(allRelPaths);
}
