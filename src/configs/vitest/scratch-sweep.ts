/** Bounded, ownership-aware startup sweep for the scratch namespace. */
import * as path from "node:path";

import { sweepAuthorizedScratchNamespace } from "./scratch-authority.js";
import { parseRunRootName, scratchNamespaceDir } from "./scratch-paths.js";
import {
  processBirthFingerprintSnapshot,
  readScratchOwnerRecord,
} from "./scratch-owner.js";
import { readBoundedScratchNamespace } from "./scratch-namespace-reader.js";

/** Inputs deciding whether one namespace entry may be removed. */
export interface ReclaimDecisionInput {
  readonly name: string;
  readonly now: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly maxAgeMs?: number;
  readonly selfName?: string;
}

/** Outcome of one sweep of the namespace. */
export interface SweepResult {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/** Options controlling one sweep. */
export interface SweepOptions {
  readonly now?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly maxAgeMs?: number;
  readonly selfName?: string;
  readonly processBirthFingerprint?: (pid: number) => string | undefined;
}

/**
 * Decide whether a recognized entry belongs to a dead process.
 * @param input - Entry and liveness facts
 * @param input.name - Direct namespace basename
 * @param input.isProcessAlive - Recorded-owner liveness probe
 * @param input.selfName - Optional caller-owned basename
 * @returns True only for a recognized dead-process name
 */
export const isReclaimable = ({
  name,
  isProcessAlive: alive,
  selfName,
}: ReclaimDecisionInput): boolean => {
  if (selfName !== undefined && name === selfName) return false;
  const owner = parseRunRootName(name);
  return owner !== undefined && !alive(owner.pid);
};

/**
 * Report whether a pid resolves to a running process.
 * @param pid - Process id to probe
 * @returns True when the kernel still resolves the process
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Refuse to authorize a foreign entry using age alone.
 * @param _entryPath - Retained compatibility path
 * @param _now - Retained compatibility clock
 * @param _maxAgeMs - Retained compatibility age
 * @returns Always false
 */
export const isStaleForeignEntry = (
  _entryPath: string,
  _now: number,
  _maxAgeMs: number
): boolean => false;

/**
 * Read bounded direct namespace entries.
 * @param dir - Exact namespace directory
 * @returns Direct basenames, or an empty list when absent
 */
export const readNamespaceEntries = (dir: string): readonly string[] =>
  readBoundedScratchNamespace(dir);

/**
 * Capture birth fingerprints for the currently live marked owners.
 * @param dir - Exact namespace path
 * @param alive - Process liveness probe
 * @returns Snapshot-backed process-birth probe
 */
function liveBirthProbe(
  dir: string,
  alive: (pid: number) => boolean
): (pid: number) => string | undefined {
  const livePids = readNamespaceEntries(dir).flatMap(name => {
    try {
      const pid = readScratchOwnerRecord(path.join(dir, name)).pid;
      return alive(pid) ? [pid] : [];
    } catch {
      return [];
    }
  });
  const snapshot = processBirthFingerprintSnapshot(livePids);
  return (pid: number): string | undefined => snapshot.get(pid);
}

/**
 * Sweep abandoned marked roots using process-birth authority.
 * @param options - Sweep inputs
 * @returns Removed and preserved names
 */
export const sweepScratchNamespace = (
  options: SweepOptions = {}
): SweepResult => {
  const dir = scratchNamespaceDir();
  const alive = options.isProcessAlive ?? isProcessAlive;
  const birthProbe =
    options.processBirthFingerprint ?? liveBirthProbe(dir, alive);
  return sweepAuthorizedScratchNamespace({
    isProcessAlive: alive,
    processBirthFingerprint: birthProbe,
    ...(options.selfName === undefined ? {} : { selfName: options.selfName }),
  });
};
