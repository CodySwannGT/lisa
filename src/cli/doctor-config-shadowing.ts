/**
 * `lisa doctor` check: is a Lisa-seeded config outranking the project's own?
 *
 * `src/core/config-shadowing.ts` closed the create path — Lisa no longer
 * writes `knip.json` into a repository that already configures knip under a
 * filename `knip.json` would outrank. That guard is reached once per path, on
 * the write that never happens again, so it cannot reach the repositories that
 * already received the file. Those are the silent population: the seeded file
 * is neither tracked nor gitignored, so it reads as something a developer
 * created; the postinstall that wrote it is skipped under `CI`, so no pipeline
 * ever reproduces it; and until this check, nothing in Lisa looked for the
 * pair (CodySwannGT/lisa#3858).
 *
 * The whole point is that an affected repository can find ITSELF, which means
 * a probe that cannot read must never render as a clean tree. Every filesystem
 * answer here is three-valued — present, absent, or undeterminable — and the
 * last one fails rather than passing quietly, because "reported nothing"
 * looking identical to "found nothing" is the defect this check exists to end.
 * @module cli/doctor-config-shadowing
 */
import { stat } from "node:fs/promises";
import * as path from "node:path";
import {
  installedConfigShadowings,
  type InstalledConfigShadowing,
} from "../core/config-shadowing.js";

/** Name of the config-precedence check as doctor reports it. */
export const CONFIG_SHADOWING_CHECK_NAME = "Config precedence clean?";

/** Shape of one doctor check result (structurally identical to doctor's). */
interface ShadowingCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Errno codes that answer the question rather than refusing it: the path is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look, which is not the same answer
 * and must not be spelled the same way.
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/**
 * The errno code of a rejected filesystem call, when it carries one.
 * @param error - Value thrown by a filesystem call
 * @returns The errno code, or undefined when the value carries none
 */
function errnoCode(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Answer whether a repo-relative path exists, REJECTING when the filesystem
 * declines to say.
 *
 * `fs-extra`'s `pathExists` resolves false for every failure, including a
 * permission denial, so a directory this process cannot read would report the
 * same "no shadowing here" as a healthy one.
 * @param projectRoot - Absolute project root
 * @param relativePath - Repo-relative path to probe
 * @returns True when the path is present, false when it is provably absent
 * @throws {Error} When the filesystem cannot answer
 */
async function probeExists(
  projectRoot: string,
  relativePath: string
): Promise<boolean> {
  try {
    await stat(path.join(projectRoot, relativePath));
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && ABSENT_CODES.has(code)) return false;
    throw new Error(
      `could not read ${relativePath}: ${code ?? String(error)}`,
      { cause: error }
    );
  }
}

/**
 * One installed shadowing, stated so the reader knows which file is being
 * read, which is being ignored, and what to do about it.
 *
 * Names the losing file explicitly. An operator who has spent an afternoon
 * editing settings that were never loaded needs to be told that specific
 * thing, not that "a precedence conflict exists".
 * @param shadowing - Pair found on disk
 * @returns One operator-readable clause
 */
function describeShadowing(shadowing: InstalledConfigShadowing): string {
  return (
    `${shadowing.template} outranks ${shadowing.sibling}, so ${shadowing.tool} ` +
    `reads ${shadowing.template} and the settings in ${shadowing.sibling} are ` +
    `not being read. Lisa seeded ${shadowing.template}; delete it to restore ` +
    `${shadowing.sibling}. \`lisa apply\` will not write it back, because it ` +
    `now stands down whenever a config it would outrank is present`
  );
}

/**
 * Report whether Lisa's seeded config files outrank configs the project wrote
 * itself.
 *
 * Fails rather than warns on a hit: the project's configuration is not being
 * read right now, the remedy is one deletion, and nothing else in the toolchain
 * will ever mention it. Fails equally when the tree could not be inspected,
 * for the reason in the module note.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkConfigShadowing(
  targetPath: string
): Promise<ShadowingCheckResult> {
  try {
    const root = await stat(targetPath);
    if (!root.isDirectory()) {
      throw new Error(`${targetPath} is not a directory`);
    }
    const shadowings = await installedConfigShadowings(relativePath =>
      probeExists(targetPath, relativePath)
    );
    return shadowings.length === 0
      ? {
          name: CONFIG_SHADOWING_CHECK_NAME,
          status: "ok",
          detail: "No Lisa-seeded config outranks a config this project wrote",
        }
      : {
          name: CONFIG_SHADOWING_CHECK_NAME,
          status: "fail",
          detail: shadowings.map(describeShadowing).join(". "),
        };
  } catch (error) {
    return {
      name: CONFIG_SHADOWING_CHECK_NAME,
      status: "fail",
      detail: `Could not determine config precedence: ${
        error instanceof Error ? error.message : String(error)
      }. Treated as a failure rather than a pass: an unreadable tree is not a clean one`,
    };
  }
}
