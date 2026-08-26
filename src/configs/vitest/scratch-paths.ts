/** Canonical paths and names for the managed Vitest scratch namespace. */
import * as path from "node:path";

import { scratchPlatformTempRoot } from "./scratch-authority.js";
import {
  SCRATCH_RUN_ROOT_PREFIX,
  parseScratchRunRootName,
  scratchRunRootName,
} from "./scratch-owner.js";

/** Single directory name every Lisa scratch root nests under. */
export const SCRATCH_NAMESPACE = "lisa-scratch";

/** Prefix identifying a per-process run root inside the namespace. */
export const RUN_ROOT_PREFIX = SCRATCH_RUN_ROOT_PREFIX;

/** Legacy default retained for callers; age alone never authorizes deletion. */
export const DEFAULT_RECLAIM_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Resolve the only public platform-temp authority.
 * @returns Absolute path containing the scratch namespace
 */
export const scratchBaseDir = (): string => scratchPlatformTempRoot();

/**
 * Resolve the shared namespace directory.
 * @returns Path to the direct `lisa-scratch` namespace
 */
export const scratchNamespaceDir = (): string =>
  path.join(scratchBaseDir(), SCRATCH_NAMESPACE);

/** Build one unique direct run-root basename. */
export const runRootName = scratchRunRootName;

/** Parse one recognized direct run-root basename. */
export const parseRunRootName = parseScratchRunRootName;
