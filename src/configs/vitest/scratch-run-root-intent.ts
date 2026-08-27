/** Pre-root intent, materialization, and reopening for one owned scratch root. */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCRATCH_QUARANTINE_PREFIX,
  createScratchNamespaceAuthority,
  readBoundedScratchNamespace,
  removeAuthorizedScratchRoot,
  runRootName,
  type ScratchNamespaceAuthority,
} from "./scratch-authority.js";
import {
  registeredScratchPrefixes,
  scratchSuiteLabel,
} from "./scratch-route-profile.js";
import {
  createScratchOwnerRecord,
  processBirthFingerprint,
  readScratchOwnerRecord,
  scratchPathIdentity,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
  type ScratchPathIdentity,
} from "./scratch-owner.js";

/** Durable handle for one run root owned by this process. */
export interface OwnedScratchRunRoot {
  readonly path: string;
  readonly basename: string;
  readonly authority: ScratchNamespaceAuthority;
  readonly owner: ScratchOwnerRecordV1;
}

/** Precommitted immutable intent for one exact direct run root. */
export interface ScratchRunRootIntentV1 {
  readonly schema: 1;
  readonly rootPath: string;
  readonly basename: string;
  readonly authority: ScratchNamespaceAuthority;
  readonly pid: number;
  readonly processBirthFingerprint: string;
  readonly createdAt: string;
  readonly token: string;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Deterministic seams for precommitting process-birth authority. */
interface PrepareRunRootOptions {
  readonly platform?: NodeJS.Platform;
  readonly processBirthFingerprint?: (pid: number) => string | undefined;
  readonly suiteLabel?: string;
  readonly registeredPrefixes?: readonly string[];
}

/** Deterministic seams for transactional root materialization. */
interface MaterializeRunRootOptions {
  readonly writeOwnerRecord?: typeof writeScratchOwnerRecord;
}

/**
 * Prepare an exact root identity without creating that root.
 * @param options - Deterministic authority seams
 * @returns Immutable precommitted root intent
 */
export function prepareOwnedScratchRunRoot(
  options: PrepareRunRootOptions = {}
): ScratchRunRootIntentV1 {
  const suiteLabel = options.suiteLabel ?? scratchSuiteLabel();
  const prefixes = options.registeredPrefixes ?? registeredScratchPrefixes();
  const authority = createScratchNamespaceAuthority();
  const now = Date.now();
  const basename = runRootName(
    process.pid,
    now,
    randomBytes(4).toString("hex")
  );
  const platform = options.platform ?? process.platform;
  const birth = (options.processBirthFingerprint ?? processBirthFingerprint)(
    process.pid
  );
  if (birth === undefined && (platform === "darwin" || platform === "linux")) {
    throw new Error(
      `Scratch process-birth authority is unavailable on ${platform}`
    );
  }
  return Object.freeze({
    schema: 1 as const,
    rootPath: path.join(authority.namespace.canonicalPath, basename),
    basename,
    authority,
    pid: process.pid,
    processBirthFingerprint: birth ?? `unsupported:${String(process.pid)}`,
    createdAt: new Date(now).toISOString(),
    token: randomBytes(16).toString("hex"),
    suiteLabel,
    registeredPrefixes: prefixes,
  });
}

/**
 * Materialize one armed root and persist its immutable marker.
 * @param intent - Precommitted root intent
 * @param options - Transactional marker-writer seams
 * @returns Durable owned-root handle
 */
export function materializeOwnedScratchRunRoot(
  intent: ScratchRunRootIntentV1,
  options: MaterializeRunRootOptions = {}
): OwnedScratchRunRoot {
  if (intent.schema !== 1)
    throw new Error("Invalid scratch root intent schema");
  if (
    path.join(intent.authority.namespace.canonicalPath, intent.basename) !==
    intent.rootPath
  ) {
    throw new Error("Scratch root intent path does not match its authority");
  }
  const expectedIdentity = (() => {
    fs.mkdirSync(intent.rootPath, { mode: 0o700 });
    return scratchPathIdentity(intent.rootPath);
  })();
  try {
    const owner = createScratchOwnerRecord({
      authority: intent.authority,
      root: intent.rootPath,
      pid: intent.pid,
      processBirthFingerprint: intent.processBirthFingerprint,
      suiteLabel: intent.suiteLabel,
      registeredPrefixes: intent.registeredPrefixes,
      token: intent.token,
      now: new Date(intent.createdAt),
    });
    (options.writeOwnerRecord ?? writeScratchOwnerRecord)(
      intent.rootPath,
      owner
    );
    return {
      path: intent.rootPath,
      basename: intent.basename,
      authority: intent.authority,
      owner,
    };
  } catch (error) {
    try {
      removeAuthorizedScratchRoot({
        authority: intent.authority,
        basename: intent.basename,
        expectedIdentity,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Scratch root materialization failed and rollback could not reclaim it"
      );
    }
    throw error;
  }
}

/**
 * Validate an opened marker against the complete armed intent.
 * @param intent - Precommitted root facts
 * @param owner - Persisted owner marker
 * @param root - Currently opened root identity
 */
function assertIntentOwner(
  intent: ScratchRunRootIntentV1,
  owner: ScratchOwnerRecordV1,
  root: ScratchPathIdentity
): void {
  if (
    owner.token !== intent.token ||
    owner.pid !== intent.pid ||
    owner.processBirthFingerprint !== intent.processBirthFingerprint ||
    owner.namespace.dev !== intent.authority.namespace.dev ||
    owner.namespace.ino !== intent.authority.namespace.ino ||
    owner.root.dev !== root.dev ||
    owner.root.ino !== root.ino
  ) {
    throw new Error(
      "Scratch owner token or armed identity does not match intent"
    );
  }
}

/**
 * Open one exact materialized root without following a replacement symlink.
 * @param intent - Armed root intent
 * @returns Owned handle, or undefined when not yet materialized
 */
export function openOwnedScratchRunRoot(
  intent: ScratchRunRootIntentV1
): OwnedScratchRunRoot | undefined {
  // eslint-disable-next-line functional/no-let -- path-level ENOENT must be separated from marker-level ENOENT
  let root: ScratchPathIdentity;
  try {
    root = scratchPathIdentity(intent.rootPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const owner = readScratchOwnerRecord(intent.rootPath);
  assertIntentOwner(intent, owner, root);
  return {
    path: intent.rootPath,
    basename: intent.basename,
    authority: intent.authority,
    owner,
  };
}

/**
 * Find an interrupted quarantine bound to the intent token and root inode.
 * @param intent - Precommitted root facts
 * @returns Matching quarantine identity, or undefined
 */
function interruptedQuarantine(
  intent: ScratchRunRootIntentV1
):
  | { readonly basename: string; readonly identity: ScratchPathIdentity }
  | undefined {
  for (const basename of readBoundedScratchNamespace(
    intent.authority.namespace.canonicalPath
  )) {
    if (!basename.startsWith(SCRATCH_QUARANTINE_PREFIX)) continue;
    const candidate = path.join(
      intent.authority.namespace.canonicalPath,
      basename
    );
    try {
      const owner = readScratchOwnerRecord(candidate);
      if (owner.token !== intent.token) continue;
      const identity = scratchPathIdentity(candidate);
      assertIntentOwner(intent, owner, identity);
      return { basename, identity };
    } catch {
      // Foreign and malformed quarantines never authorize this intent.
    }
  }
  return undefined;
}

/**
 * Remove a run root using only the authority captured when it was made.
 * @param owned - Durable handle or precommitted intent
 */
export function removeOwnedScratchRunRoot(
  owned: OwnedScratchRunRoot | ScratchRunRootIntentV1
): void {
  if ("rootPath" in owned) {
    const opened = openOwnedScratchRunRoot(owned);
    if (opened !== undefined) {
      removeOwnedScratchRunRoot(opened);
      return;
    }
    const quarantine = interruptedQuarantine(owned);
    if (quarantine === undefined) return;
    removeAuthorizedScratchRoot({
      authority: owned.authority,
      basename: quarantine.basename,
      expectedToken: owned.token,
      expectedIdentity: quarantine.identity,
    });
    return;
  }
  removeAuthorizedScratchRoot({
    authority: owned.authority,
    basename: owned.basename,
    expectedToken: owned.owner.token,
    expectedIdentity: owned.owner.root,
  });
}

export { assertIntentOwner };
