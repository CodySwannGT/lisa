/** Kernel-bound deletion programs for scratch roots and their direct children. */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  scratchPathIdentity,
  type ScratchPathIdentity,
} from "./scratch-owner.js";
import { BOUND_CHILDREN_CLEANUP_PROGRAM } from "./scratch-bound-cleanup-programs.js";

export { BOUND_DIRECTORY_CLEANUP_PROGRAM } from "./scratch-bound-cleanup-programs.js";

/** Options for removing one direct child of an already-owned run root. */
export interface RemoveAuthorizedScratchChildOptions {
  readonly parent: ScratchPathIdentity;
  readonly basename: string;
  readonly beforeIdentityCheck?: (candidate: string) => void;
  readonly afterIdentityCheck?: (candidate: string) => void;
}

/** Options for one batched removal under an already-owned run root. */
export interface RemoveAuthorizedScratchChildrenOptions {
  readonly parent: ScratchPathIdentity;
  readonly basenames: readonly string[];
  readonly beforeIdentityCheck?: (candidate: string) => void;
  readonly afterIdentityCheck?: (candidate: string) => void;
  readonly beforeBoundCleanup?: () => void;
}

/** Exit status used when the child cwd does not match the expected inode. */
const BOUND_CLEANUP_IDENTITY_EXIT = 73;

/**
 * Demand one inert direct basename, never a path.
 * @param basename - Candidate direct-child name
 */
function validateBasename(basename: string): void {
  if (
    basename === "" ||
    basename === "." ||
    basename === ".." ||
    path.basename(basename) !== basename ||
    basename.includes("/") ||
    basename.includes("\\")
  ) {
    throw new Error(`Scratch candidate must be a direct basename: ${basename}`);
  }
  if (Buffer.byteLength(basename, "utf8") > 1_024) {
    throw new Error("Scratch candidate basename exceeds 1024 bytes");
  }
}

/**
 * Read one candidate without converting absence into an exception.
 * @param candidate - Candidate path
 * @returns Candidate metadata, or undefined when already absent
 */
function lstatIfPresent(candidate: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Assert that an already-owned parent still has its pinned identity.
 * @param expected - Pinned parent identity
 */
function assertScratchPathIdentity(expected: ScratchPathIdentity): void {
  const current = scratchPathIdentity(expected.canonicalPath);
  if (
    current.canonicalPath !== expected.canonicalPath ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new Error("Scratch parent identity changed before child cleanup");
  }
}

/**
 * Inspect a direct child after its pinned parent passes revalidation.
 * @param parent - Pinned parent identity
 * @param basename - Direct-child name
 * @param child - Candidate path
 * @returns Candidate metadata, or undefined when already absent
 */
function inspectAuthorizedScratchChild(
  parent: ScratchPathIdentity,
  basename: string,
  child: string
): fs.Stats | undefined {
  validateBasename(basename);
  assertScratchPathIdentity(parent);
  return lstatIfPresent(child);
}

/**
 * Capture every present candidate while the parent remains pinned.
 * @param options - Batched child-removal options
 * @returns Bound cleanup descriptions for present children
 */
function collectAuthorizedChildren(
  options: RemoveAuthorizedScratchChildrenOptions
): readonly Record<string, string | boolean>[] {
  assertScratchPathIdentity(options.parent);
  return options.basenames.flatMap(basename => {
    const child = path.join(options.parent.canonicalPath, basename);
    options.beforeIdentityCheck?.(child);
    const stat = inspectAuthorizedScratchChild(options.parent, basename, child);
    if (stat === undefined) return [];
    options.afterIdentityCheck?.(child);
    return [
      {
        basename,
        dev: String(stat.dev),
        ino: String(stat.ino),
        directory: stat.isDirectory(),
        symlink: stat.isSymbolicLink(),
      },
    ];
  });
}

/**
 * Execute the inode-bound child-cleanup worker.
 * @param options - Batched child-removal options
 * @param input - Validated serialized child descriptions
 * @returns Worker result
 */
function executeBoundChildrenCleanup(
  options: RemoveAuthorizedScratchChildrenOptions,
  input: string
): SpawnSyncReturns<string> {
  options.beforeBoundCleanup?.();
  return spawnSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      BOUND_CHILDREN_CLEANUP_PROGRAM,
      String(options.parent.dev),
      String(options.parent.ino),
    ],
    {
      cwd: options.parent.canonicalPath,
      encoding: "utf8",
      input,
      maxBuffer: 64 * 1024,
    }
  );
}

/**
 * Remove direct children through one process bound to the parent inode.
 * @param options - Batched child-removal options
 */
export function removeAuthorizedScratchChildren(
  options: RemoveAuthorizedScratchChildrenOptions
): void {
  if (new Set(options.basenames).size !== options.basenames.length) {
    throw new Error("Scratch child cleanup refuses duplicate basenames");
  }
  const items = collectAuthorizedChildren(options);
  if (items.length === 0) return;
  const input = JSON.stringify(items);
  if (Buffer.byteLength(input, "utf8") > 32 * 1024 * 1024) {
    throw new Error("Scratch child cleanup batch exceeds 33554432 bytes");
  }
  const result = executeBoundChildrenCleanup(options, input);
  if (result.error !== undefined) throw result.error;
  if (result.status === BOUND_CLEANUP_IDENTITY_EXIT) {
    throw new Error(
      result.stderr.trim() ||
        "Scratch child identity changed before bound cleanup"
    );
  }
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(
      `Scratch bound cleanup failed: ${result.stderr.trim() || result.signal || String(result.status)}`
    );
  }
  assertScratchPathIdentity(options.parent);
}

/**
 * Remove one direct child through the batched authority.
 * @param options - Single child-removal options
 */
export function removeAuthorizedScratchChild(
  options: RemoveAuthorizedScratchChildOptions
): void {
  removeAuthorizedScratchChildren({
    parent: options.parent,
    basenames: [options.basename],
    ...(options.beforeIdentityCheck === undefined
      ? {}
      : { beforeIdentityCheck: options.beforeIdentityCheck }),
    ...(options.afterIdentityCheck === undefined
      ? {}
      : { afterIdentityCheck: options.afterIdentityCheck }),
  });
}
