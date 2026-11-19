/**
 * @file package-lisa-direct-floors.ts
 * @description Holds and raises a host's direct dependency ranges to Lisa's
 * minimums and force floors before the manifest is persisted.
 * @module strategies
 */
import {
  applyDirectMinimums,
  describeDirectMinimumConflicts,
  describeDirectMinimumRaise,
} from "../core/direct-minimums.js";
import { raiseDirectRangesToLisaFloors } from "../core/direct-range-raise.js";
import { JsonMergeError } from "../errors/index.js";
import type { ResolvedPackageLisaTemplate } from "./package-lisa-types.js";

/**
 * Hold a host's direct ranges at or above Lisa's minimums, refusing a raise
 * that would cross a major, then raise any direct range still below a Lisa
 * force floor.
 * @param pkg - Merged package.json about to be persisted
 * @param template - The effective template supplying minimums and force floors
 * @param fileName - Basename used in error messages
 * @throws {JsonMergeError} naming every range no same-major raise reaches
 * @returns The fitted manifest and one note per range it raised
 */
export function fitDirectRangesToLisaFloors(
  pkg: Record<string, unknown>,
  template: Pick<ResolvedPackageLisaTemplate, "force" | "minimums">,
  fileName: string
): {
  readonly packageJson: Record<string, unknown>;
  readonly notes: readonly string[];
} {
  const held = applyDirectMinimums(pkg, template.minimums);
  const [first, ...rest] = held.conflicts;
  if (first !== undefined) {
    throw new JsonMergeError(
      fileName,
      describeDirectMinimumConflicts([first, ...rest])
    );
  }
  const raised = raiseDirectRangesToLisaFloors(
    held.packageJson,
    template.force
  );
  return {
    packageJson: raised.packageJson,
    notes: [
      ...held.raises.map(describeDirectMinimumRaise),
      ...raised.raises.map(
        raise =>
          `Raised ${raise.section}.${raise.name} from ${JSON.stringify(raise.from)} to ` +
          `${JSON.stringify(raise.to)} to meet Lisa's floor ` +
          `${JSON.stringify(raise.floorRange)}.`
      ),
    ],
  };
}
