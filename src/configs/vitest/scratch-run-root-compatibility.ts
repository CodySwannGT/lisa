/** Compatibility allocation/adoption atop the owned run-root lifecycle. */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  createScratchNamespaceAuthority,
  removeAuthorizedScratchRoot,
  type ScratchNamespaceAuthority,
} from "./scratch-authority.js";
import {
  registeredScratchPrefixes,
  scratchSuiteLabel,
} from "./scratch-route-profile.js";
import {
  createScratchOwnerRecord,
  readScratchOwnerRecord,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
} from "./scratch-owner.js";
import { parseRunRootName, runRootName } from "./scratch-paths.js";
import { sweepScratchNamespace } from "./scratch-sweep.js";
import type { OwnedScratchRunRoot } from "./scratch-run-root-intent.js";

/** Validated owner configuration captured before filesystem allocation. */
interface ScratchOwnerConfiguration {
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Optional seams for creating one transactional run root. */
interface CreateRunRootOptions {
  readonly now?: number;
  readonly writeOwnerRecord?: typeof writeScratchOwnerRecord;
}

/**
 * Create the immutable owner marker for a newly materialized root.
 * @param authority - Pinned namespace authority
 * @param root - Newly materialized direct root
 * @param now - Creation epoch milliseconds
 * @param configuration - Validated owner attribution
 * @returns Immutable owner marker
 */
function createOwnerForNewRoot(
  authority: ScratchNamespaceAuthority,
  root: string,
  now: number,
  configuration: ScratchOwnerConfiguration
): ScratchOwnerRecordV1 {
  return createScratchOwnerRecord({
    authority,
    root,
    suiteLabel: configuration.suiteLabel,
    registeredPrefixes: configuration.registeredPrefixes,
    now: new Date(now),
  });
}

/**
 * Create a legacy-compatible owned root with transactional marker rollback.
 * @param options - Clock and marker-writer seams
 * @param options.now - Epoch milliseconds recorded in the basename
 * @param options.writeOwnerRecord - Injectable transactional marker writer
 * @returns Absolute run-root path
 */
export const createRunRoot = ({
  now = Date.now(),
  writeOwnerRecord = writeScratchOwnerRecord,
}: CreateRunRootOptions = {}): string => {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error(
      "Scratch run-root timestamp must be a non-negative integer"
    );
  }
  const configuration: ScratchOwnerConfiguration = {
    suiteLabel: scratchSuiteLabel(),
    registeredPrefixes: registeredScratchPrefixes(),
  };
  const authority = createScratchNamespaceAuthority();
  const root = path.join(
    authority.namespace.canonicalPath,
    runRootName(process.pid, now, randomBytes(4).toString("hex"))
  );
  fs.mkdirSync(root, { mode: 0o700 });
  try {
    const owner = createOwnerForNewRoot(authority, root, now, configuration);
    writeOwnerRecord(root, owner);
  } catch (error) {
    try {
      removeAuthorizedScratchRoot({
        authority,
        basename: path.basename(root),
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Scratch root allocation failed and rollback could not reclaim it"
      );
    }
    throw error;
  }
  return root;
};

/**
 * Reclaim residue, then allocate a durable owned-root handle.
 * @returns Owned current-process root
 */
export function reclaimAndCreateOwnedRunRoot(): OwnedScratchRunRoot {
  const authority = createScratchNamespaceAuthority();
  const root = (() => {
    sweepScratchNamespace();
    return createRunRoot();
  })();
  return {
    path: root,
    basename: path.basename(root),
    authority,
    owner: readScratchOwnerRecord(root),
  };
}

/**
 * Read an existing marker or atomically upgrade a legacy current root.
 * @param authority - Pinned namespace authority
 * @param root - Existing current-process root
 * @param startedAt - Timestamp encoded in the recognized basename
 * @returns Existing or newly written marker
 */
function readOrCreateAdoptedOwner(
  authority: ScratchNamespaceAuthority,
  root: string,
  startedAt: number
): ScratchOwnerRecordV1 {
  try {
    return readScratchOwnerRecord(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const owner = createScratchOwnerRecord({
      authority,
      root,
      suiteLabel: scratchSuiteLabel(),
      registeredPrefixes: registeredScratchPrefixes(),
      now: new Date(startedAt),
    });
    writeScratchOwnerRecord(root, owner);
    return owner;
  }
}

/**
 * Upgrade a source/dist-compatible path memo created by an older setup copy.
 * @param root - Existing memoized run-root path
 * @returns Durable handle for the existing root
 */
export function adoptOwnedScratchRunRoot(root: string): OwnedScratchRunRoot {
  const authority = createScratchNamespaceAuthority();
  const canonicalRoot = fs.realpathSync(root);
  if (
    path.dirname(canonicalRoot) !== authority.namespace.canonicalPath ||
    path.basename(root) !== path.basename(canonicalRoot)
  ) {
    throw new Error("Memoized scratch root is outside canonical authority");
  }
  const parsed = parseRunRootName(path.basename(root));
  if (parsed?.pid !== process.pid) {
    throw new Error("Memoized scratch root is not owned by this process");
  }
  const owner = readOrCreateAdoptedOwner(authority, root, parsed.startedAt);
  return {
    path: root,
    basename: path.basename(root),
    authority,
    owner,
  };
}

/**
 * Reclaim residue, then return one current-process root path.
 * @returns Newly allocated root path
 */
export const reclaimAndCreateRunRoot = (): string =>
  reclaimAndCreateOwnedRunRoot().path;
