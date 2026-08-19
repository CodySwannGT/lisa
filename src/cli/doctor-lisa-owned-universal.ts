/**
 * Which Lisa-owned artifacts every project receives, whatever stack it is.
 *
 * Kept separate from `doctor-lisa-owned-artifacts.ts` for the max-lines budget,
 * the same way the safety-net fixtures are split. The distinction it encodes is
 * small but load-bearing: absence of a STACK artifact proves nothing, because
 * that stack may simply not apply here, while absence of a UNIVERSAL one means
 * apply never ran and the CI gate that calls it is not running at all.
 * @module cli/doctor-lisa-owned-universal
 */
import * as path from "node:path";
import * as fse from "fs-extra";

import { isLisaOwnedTemplate } from "../core/lisa-owned-templates.js";
import { listFilesRecursive } from "../utils/file-operations.js";

/** Directory name of the strategy tree these artifacts are shipped from. */
export const COPY_OVERWRITE = "copy-overwrite";

/**
 * The stack tree every project receives regardless of detected type.
 *
 * `Lisa.processProjectType("all")` runs unconditionally and every downstream
 * loop is `["all", ...detectedTypes]`, so an artifact shipped here has no stack
 * it legitimately does not apply to.
 */
export const UNIVERSAL_STACK = "all";

/** One shipped Lisa-owned artifact and the destination it installs to. */
export type ShippedArtifact = readonly [destination: string, source: string];

/**
 * List the Lisa-owned artifacts one stack's copy-overwrite tree ships.
 * @param lisaRoot - Installed Lisa package root
 * @param type - Stack directory name
 * @returns Destination/source pairs shipped by that stack
 */
export async function shippedByStack(
  lisaRoot: string,
  type: string
): Promise<readonly ShippedArtifact[]> {
  const directory = path.join(lisaRoot, type, COPY_OVERWRITE);
  if (!(await fse.pathExists(directory))) return [];
  return (await listFilesRecursive(directory))
    .map(
      source =>
        [
          path.relative(directory, source).split(path.sep).join("/"),
          source,
        ] as const
    )
    .filter(([destination]) => isLisaOwnedTemplate(destination));
}

/**
 * Destinations shipped by the universal tree, which every project receives.
 * @param lisaRoot - Installed Lisa package root
 * @returns Destination paths no project can legitimately be without
 */
export async function universalDestinations(
  lisaRoot: string
): Promise<ReadonlySet<string>> {
  return new Set(
    (await shippedByStack(lisaRoot, UNIVERSAL_STACK)).map(
      ([destination]) => destination
    )
  );
}
