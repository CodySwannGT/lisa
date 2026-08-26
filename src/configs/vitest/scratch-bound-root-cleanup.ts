/** Kernel-bound removal of one token-authorized scratch run root. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCRATCH_QUARANTINE_PREFIX,
  assertScratchNamespaceAuthority,
  type ScratchNamespaceAuthority,
} from "./scratch-namespace-authority.js";
import { BOUND_DIRECTORY_CLEANUP_PROGRAM } from "./scratch-bound-cleanup-programs.js";
import {
  readScratchOwnerRecord,
  type ScratchPathIdentity,
} from "./scratch-owner.js";

/** Options for an authorised root removal. */
export interface RemoveAuthorizedScratchRootOptions {
  readonly authority: ScratchNamespaceAuthority;
  readonly basename: string;
  readonly expectedToken?: string;
  readonly expectedIdentity?: ScratchPathIdentity;
  readonly afterIdentityCheck?: (candidate: string) => void;
}

/** Exit status used when a child cwd does not match its expected inode. */
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
 * Clear a directory through a cwd bound to the inspected inode.
 * @param candidate - Directory path
 * @param expected - Pinned directory identity
 */
function clearDirectoryThroughBoundCwd(
  candidate: string,
  expected: fs.Stats
): void {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      BOUND_DIRECTORY_CLEANUP_PROGRAM,
      String(expected.dev),
      String(expected.ino),
    ],
    { cwd: candidate, encoding: "utf8", maxBuffer: 64 * 1024 }
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === BOUND_CLEANUP_IDENTITY_EXIT) {
    throw new Error("Scratch directory identity changed before bound cleanup");
  }
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(
      `Scratch bound cleanup failed: ${result.stderr.trim() || result.signal || String(result.status)}`
    );
  }
}

/**
 * Bind an optional armed inode identity to the inspected candidate.
 * @param options - Authorized root-removal options
 * @param stat - Candidate metadata when present
 * @returns Validated metadata, or undefined when already absent
 */
function validateExpectedRootIdentity(
  options: RemoveAuthorizedScratchRootOptions,
  stat: fs.Stats | undefined
): fs.Stats | undefined {
  if (
    stat !== undefined &&
    options.expectedIdentity !== undefined &&
    (stat.dev !== options.expectedIdentity.dev ||
      stat.ino !== options.expectedIdentity.ino)
  ) {
    throw new Error("Scratch root identity does not match armed intent");
  }
  return stat;
}

/**
 * Validate authority before reading a destructive candidate.
 * @param options - Authorized root-removal options
 * @param candidate - Candidate path
 * @returns Candidate metadata, or undefined when already absent
 */
function inspectAuthorizedCandidate(
  options: RemoveAuthorizedScratchRootOptions,
  candidate: string
): fs.Stats | undefined {
  validateBasename(options.basename);
  assertScratchNamespaceAuthority(options.authority);
  return validateExpectedRootIdentity(options, lstatIfPresent(candidate));
}

/**
 * Revalidate an expected marker token at a specific path.
 * @param candidate - Candidate path
 * @param expectedToken - Token authorized by the caller
 * @param phase - Whether validation occurs before or after quarantine
 */
function assertOwnerToken(
  candidate: string,
  expectedToken: string | undefined,
  phase: "before" | "after"
): void {
  if (expectedToken === undefined) return;
  const owner = readScratchOwnerRecord(candidate);
  if (owner.token !== expectedToken) {
    throw new Error(`Scratch owner token changed ${phase} quarantine`);
  }
}

/**
 * Revalidate and unlink the renamed candidate.
 * @param quarantine - Quarantined path
 * @param before - Pinned pre-rename metadata
 * @param expectedToken - Token authorized by the caller
 * @param afterIdentityCheck - Optional adversarial test hook
 * @returns True after successful removal
 */
function removeVerifiedQuarantine(
  quarantine: string,
  before: fs.Stats,
  expectedToken: string | undefined,
  afterIdentityCheck: ((candidate: string) => void) | undefined
): true {
  const after = fs.lstatSync(quarantine);
  if (
    after.isSymbolicLink() ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    throw new Error("Scratch root identity changed during quarantine");
  }
  afterIdentityCheck?.(quarantine);
  assertOwnerToken(quarantine, expectedToken, "after");
  clearDirectoryThroughBoundCwd(quarantine, after);
  fs.rmdirSync(quarantine);
  return true;
}

/**
 * Quarantine and delete one direct owned root.
 * @param options - Authorized root-removal options
 * @returns Whether an existing root was removed
 */
export function removeAuthorizedScratchRoot(
  options: RemoveAuthorizedScratchRootOptions
): boolean {
  const candidate = path.join(
    options.authority.namespace.canonicalPath,
    options.basename
  );
  const quarantineName = `${SCRATCH_QUARANTINE_PREFIX}${randomBytes(16).toString("hex")}`;
  const quarantine = path.join(
    options.authority.namespace.canonicalPath,
    quarantineName
  );
  const before = inspectAuthorizedCandidate(options, candidate);
  if (before === undefined) return false;
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(
      `Scratch root authority refuses non-directory or symlink: ${candidate}`
    );
  }
  assertOwnerToken(candidate, options.expectedToken, "before");
  try {
    fs.renameSync(candidate, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return removeVerifiedQuarantine(
    quarantine,
    before,
    options.expectedToken,
    options.afterIdentityCheck
  );
}
