/**
 * Self-apply detection: whether a `lisa apply` is running against the Lisa
 * source repository itself rather than a host project.
 *
 * Applying Lisa to its own repo is a special case. The template application,
 * `deletions.json` processing, and postinstall-bootstrap injection all assume
 * the target is a *consumer* of Lisa — running them against the source repo
 * would delete Lisa's own `.claude/commands/lisa/*`, overwrite source files
 * with the very templates they generate, and chain the bootstrap invocation
 * into Lisa's own `package.json`. Dependency governance (security floors from
 * `package.lisa.json`) is the one thing that SHOULD still apply, so Lisa's own
 * deps stay on the same pinned/patched versions it forces downstream.
 * @module self-apply
 */
import * as path from "node:path";
import { readJsonOrNull } from "../utils/json-utils.js";

/** The npm package name of the Lisa source repository itself. */
export const LISA_PACKAGE_NAME = "@codyswann/lisa";

/**
 * Detect whether the destination project IS the Lisa source repository, by
 * matching its `package.json` `name` against {@link LISA_PACKAGE_NAME}.
 * @param destDir - Absolute path to the destination project root
 * @returns True when the destination is the Lisa source repo
 */
export async function isLisaSourceRepo(destDir: string): Promise<boolean> {
  const pkg = await readJsonOrNull<{ readonly name?: unknown }>(
    path.join(destDir, "package.json")
  );
  return pkg?.name === LISA_PACKAGE_NAME;
}
