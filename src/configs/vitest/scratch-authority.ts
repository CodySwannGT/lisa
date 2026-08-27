/**
 * Filesystem authority for destructive scratch cleanup.
 *
 * Every removal is constrained to one direct child of a canonical, uid-owned,
 * mode-0700 `lisa-scratch` namespace. The child is renamed to a random
 * quarantine name inside that same namespace, then its inode and owner token
 * are revalidated before a no-follow recursive unlink.
 * @module configs/vitest/scratch-authority
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  classifyScratchOwner,
  readScratchOwnerRecord,
} from "./scratch-owner.js";
import {
  SCRATCH_QUARANTINE_PREFIX,
  authorityForExistingScratchNamespace,
  readBoundedScratchNamespace,
  type ScratchNamespaceAuthority,
} from "./scratch-namespace-authority.js";
import { removeAuthorizedScratchRoot } from "./scratch-bound-root-cleanup.js";

/** Inputs for one authority-bound namespace sweep. */
export interface AuthorizedScratchSweepOptions {
  readonly isProcessAlive: (pid: number) => boolean;
  readonly processBirthFingerprint: (pid: number) => string | undefined;
  readonly selfName?: string;
}

/** Names removed and preserved by one authority-bound sweep. */
export interface AuthorizedScratchSweepResult {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/** Facts returned after binding a marker to the inspected path. */
interface OwnerPathMatch {
  readonly owner: ReturnType<typeof readScratchOwnerRecord>;
  readonly matches: boolean;
}

/**
 * Whether a marker is bound to the exact root and namespace inspected.
 * @param authority - Pinned namespace authority
 * @param root - Direct namespace child
 * @param allowQuarantine - Whether the root canonical path may reflect quarantine
 * @returns Parsed marker and whether every authority fact matches
 */
function ownerMatchesPath(
  authority: ScratchNamespaceAuthority,
  root: string,
  allowQuarantine: boolean
): OwnerPathMatch {
  const owner = readScratchOwnerRecord(root);
  const stat = fs.lstatSync(root);
  const matches =
    owner.namespace.canonicalPath === authority.namespace.canonicalPath &&
    owner.namespace.dev === authority.namespace.dev &&
    owner.namespace.ino === authority.namespace.ino &&
    owner.root.dev === stat.dev &&
    owner.root.ino === stat.ino &&
    (allowQuarantine || owner.root.canonicalPath === fs.realpathSync(root));
  return { owner, matches };
}

/**
 * Remove a marked entry only when ownership says its process is gone or reused.
 * @param authority - Pinned namespace authority
 * @param name - Direct child basename
 * @param root - Direct child path
 * @param quarantine - Whether the child is an interrupted quarantine
 * @param options - Process probes and self name
 * @returns Removal disposition
 */
function sweepMarkedEntry(
  authority: ScratchNamespaceAuthority,
  name: string,
  root: string,
  quarantine: boolean,
  options: AuthorizedScratchSweepOptions
): "removed" | "kept" {
  const marked = ownerMatchesPath(authority, root, quarantine);
  if (!marked.matches) return "kept";
  const disposition = classifyScratchOwner(marked.owner, options);
  if (disposition === "preserve") return "kept";
  removeAuthorizedScratchRoot({
    authority,
    basename: name,
    expectedToken: marked.owner.token,
  });
  return "removed";
}

/**
 * Judge one direct namespace entry without ever following a symlink.
 * @param authority - Pinned namespace authority
 * @param name - Direct child basename
 * @param options - Process probes and self name
 * @returns Removal disposition
 */
function sweepAuthorizedEntry(
  authority: ScratchNamespaceAuthority,
  name: string,
  options: AuthorizedScratchSweepOptions
): "removed" | "kept" {
  if (name === options.selfName) return "kept";
  const root = path.join(authority.namespace.canonicalPath, name);
  try {
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return "kept";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "removed"
      : "kept";
  }
  const quarantine = name.startsWith(SCRATCH_QUARANTINE_PREFIX);
  const recognized = /^run-\d+-\d+-[^/\\]+$/u.test(name);
  if (!recognized && !quarantine) return "kept";
  try {
    return sweepMarkedEntry(authority, name, root, quarantine, options);
  } catch {
    // A recognizable name is never deletion authority. Missing, malformed,
    // unreadable, oversized, or identity-mismatched markers remain in place
    // for the namespace audit to refuse with an actionable diagnosis.
    return "kept";
  }
}

/**
 * Sweep one canonical namespace using durable owner/process-birth authority.
 * @param options - Namespace and process probes
 * @returns Names removed and preserved
 */
export function sweepAuthorizedScratchNamespace(
  options: AuthorizedScratchSweepOptions
): AuthorizedScratchSweepResult {
  const authority = authorityForExistingScratchNamespace();
  if (authority === undefined) return { removed: [], kept: [] };
  return readBoundedScratchNamespace(authority.namespace.canonicalPath).reduce(
    (result: AuthorizedScratchSweepResult, name) =>
      sweepAuthorizedEntry(authority, name, options) === "removed"
        ? { removed: [...result.removed, name], kept: result.kept }
        : { removed: result.removed, kept: [...result.kept, name] },
    { removed: [], kept: [] }
  );
}

export {
  BOUND_DIRECTORY_CLEANUP_PROGRAM,
  removeAuthorizedScratchChild,
  removeAuthorizedScratchChildren,
} from "./scratch-bound-cleanup.js";

export { removeAuthorizedScratchRoot };

export {
  AUTHORIZED_SCRATCH_NAMESPACE,
  DEFAULT_RECLAIM_AGE_MS,
  MAX_SCRATCH_NAMESPACE_NAME_BYTES,
  MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES,
  RUN_ROOT_PREFIX,
  SCRATCH_DIRECT_ENTRY_LIMIT,
  SCRATCH_DIRECT_NAME_BYTES,
  SCRATCH_QUARANTINE_PREFIX,
  SCRATCH_NAMESPACE,
  assertScratchNamespaceAuthority,
  collectBoundedScratchNames,
  collectBoundedScratchNamespaceNames,
  createScratchNamespaceAuthority,
  parseRunRootName,
  readBoundedScratchNames,
  readBoundedScratchNamespace,
  runRootName,
  scratchBaseDir,
  scratchNamespaceDir,
} from "./scratch-namespace-authority.js";

export type {
  RemoveAuthorizedScratchChildOptions,
  RemoveAuthorizedScratchChildrenOptions,
} from "./scratch-bound-cleanup.js";

export type { RemoveAuthorizedScratchRootOptions } from "./scratch-bound-root-cleanup.js";

export type {
  ScratchNamespaceAuthority,
  ScratchNamespaceIdentity,
} from "./scratch-namespace-authority.js";
