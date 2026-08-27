/**
 * Bounded, self-reclaiming Vitest scratch lifecycle.
 *
 * Every fixture directory lives under one platform-temp namespace and one
 * per-process owned root. The public facade stays deliberately small: naming,
 * authority, startup sweeping, transactional allocation, and token-bound
 * teardown live in focused sibling modules.
 * @module configs/vitest/scratch
 */
import * as fs from "node:fs";

/**
 * Remove a non-authoritative fixture directory on a best-effort basis.
 *
 * Owned run-root teardown must use `removeOwnedScratchRunRoot`; this helper is
 * retained only for nested fixture compatibility, where the next bounded sweep
 * can recover residue.
 * @param dir - Nested fixture directory to remove
 */
export const removeScratchDir = (dir: string): void => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // The next owned-root teardown or startup sweep recovers nested residue.
  }
};

export {
  DEFAULT_RECLAIM_AGE_MS,
  RUN_ROOT_PREFIX,
  SCRATCH_NAMESPACE,
  parseRunRootName,
  runRootName,
  scratchBaseDir,
  scratchNamespaceDir,
} from "./scratch-paths.js";

export {
  SCRATCH_PREFIXES_ENV,
  SCRATCH_SUITE_ENV,
} from "./scratch-route-profile.js";

export {
  registeredScratchPrefixes,
  scratchSuiteLabel,
} from "./scratch-route-profile.js";

export {
  isProcessAlive,
  isReclaimable,
  isStaleForeignEntry,
  readNamespaceEntries,
  sweepScratchNamespace,
} from "./scratch-sweep.js";

export type {
  ReclaimDecisionInput,
  SweepOptions,
  SweepResult,
} from "./scratch-sweep.js";

export {
  materializeOwnedScratchRunRoot,
  openOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
} from "./scratch-run-root-intent.js";

export type {
  OwnedScratchRunRoot,
  ScratchRunRootIntentV1,
} from "./scratch-run-root-intent.js";

export {
  adoptOwnedScratchRunRoot,
  createRunRoot,
  reclaimAndCreateOwnedRunRoot,
  reclaimAndCreateRunRoot,
} from "./scratch-run-root-compatibility.js";

export { removeOwnedScratchRunRoot } from "./scratch-run-root-intent.js";
