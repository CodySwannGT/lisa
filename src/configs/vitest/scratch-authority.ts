/* eslint-disable max-lines -- namespace capture, quarantine, and no-follow removal form one auditable authority boundary */
/**
 * Filesystem authority for destructive scratch cleanup.
 *
 * Every removal is constrained to one direct child of a canonical, uid-owned,
 * mode-0700 `lisa-scratch` namespace. The child is renamed to a random
 * quarantine name inside that same namespace, then its inode and owner token
 * are revalidated before a no-follow recursive unlink.
 * @module configs/vitest/scratch-authority
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  classifyScratchOwner,
  parseScratchRunRootName,
  readScratchOwnerRecord,
  scratchPathIdentity,
  type ScratchPathIdentity,
} from "./scratch-owner.js";

/** Exact shared namespace basename. */
export const AUTHORIZED_SCRATCH_NAMESPACE = "lisa-scratch";

/** Recognisable quarantine prefix, with a random suffix per removal. */
export const SCRATCH_QUARANTINE_PREFIX = ".lisa-quarantine-";

/** Namespace identity plus local ownership facts. */
export interface ScratchNamespaceIdentity extends ScratchPathIdentity {
  readonly uid: number | undefined;
}

/** Authority required before any destructive scratch operation. */
export interface ScratchNamespaceAuthority {
  readonly baseCanonicalPath: string;
  readonly namespace: ScratchNamespaceIdentity;
}

/** Options for an authorised root removal. */
export interface RemoveAuthorizedScratchRootOptions {
  readonly authority: ScratchNamespaceAuthority;
  readonly basename: string;
  readonly expectedToken?: string;
  readonly expectedIdentity?: ScratchPathIdentity;
  readonly afterIdentityCheck?: (candidate: string) => void;
}

/** Options for removing one direct child of an already-owned run root. */
export interface RemoveAuthorizedScratchChildOptions {
  readonly parent: ScratchPathIdentity;
  readonly basename: string;
  readonly afterIdentityCheck?: (candidate: string) => void;
}

/** Inputs for one authority-bound namespace sweep. */
export interface AuthorizedScratchSweepOptions {
  readonly dir: string;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly processBirthFingerprint: (pid: number) => string | undefined;
  readonly selfName?: string;
}

/** Names removed and preserved by one authority-bound sweep. */
export interface AuthorizedScratchSweepResult {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/**
 * Return the current uid where the platform supplies one.
 * @returns Current uid or undefined on platforms without uid ownership
 */
const currentUid = (): number | undefined => process.getuid?.();

/**
 * Ensure the namespace path exists as a real directory.
 * @param namespacePath - Exact namespace path
 */
function assertRealDirectory(namespacePath: string): void {
  const existing = fs.lstatSync(namespacePath);
  if (existing.isSymbolicLink()) {
    throw new Error(
      `Scratch namespace must not be a symlink: ${namespacePath}`
    );
  }
  if (!existing.isDirectory()) {
    throw new Error(`Scratch namespace is not a directory: ${namespacePath}`);
  }
}

/**
 * Create the namespace or accept a concurrent creator only after revalidation.
 * @param namespacePath - Exact namespace path
 */
function ensureNamespaceDirectory(namespacePath: string): void {
  try {
    assertRealDirectory(namespacePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      fs.mkdirSync(namespacePath, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
        throw mkdirError;
      }
      assertRealDirectory(namespacePath);
    }
  }
}

/**
 * Assert and, for mode only, repair local namespace ownership.
 * @param namespacePath - Exact namespace path
 */
function enforceNamespaceOwnership(namespacePath: string): void {
  const stat = fs.lstatSync(namespacePath);
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(
      `Scratch namespace uid ${String(stat.uid)} does not match current uid ${String(uid)}`
    );
  }
  if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(namespacePath, 0o700);
}

/**
 * Capture the namespace identity after its creation and mode repair.
 * @param namespacePath - Exact namespace path
 * @param baseCanonicalPath - Pinned physical temp base
 * @returns Captured authority
 */
function captureNamespaceAuthority(
  namespacePath: string,
  baseCanonicalPath: string
): ScratchNamespaceAuthority {
  const uid = currentUid();
  const identity = scratchPathIdentity(namespacePath);
  if (path.dirname(identity.canonicalPath) !== baseCanonicalPath) {
    throw new Error("Scratch namespace escaped its canonical temp base");
  }
  return {
    baseCanonicalPath,
    namespace: { ...identity, uid },
  };
}

/**
 * Establish and pin the canonical scratch namespace.
 * @param baseDir - Logical temp base
 * @returns Filesystem authority for its exact direct `lisa-scratch` child
 */
export function createScratchNamespaceAuthority(
  baseDir: string
): ScratchNamespaceAuthority {
  const baseStat = fs.lstatSync(baseDir);
  if (baseStat.isSymbolicLink()) {
    throw new Error(`Scratch temp base must not be a symlink: ${baseDir}`);
  }
  if (!baseStat.isDirectory()) {
    throw new Error(`Scratch temp base is not a directory: ${baseDir}`);
  }
  const baseCanonicalPath = fs.realpathSync(baseDir);
  const namespacePath = path.join(
    baseCanonicalPath,
    AUTHORIZED_SCRATCH_NAMESPACE
  );
  ensureNamespaceDirectory(namespacePath);
  enforceNamespaceOwnership(namespacePath);
  return captureNamespaceAuthority(namespacePath, baseCanonicalPath);
}

/**
 * Revalidate that the namespace is still the directory authority pinned.
 * @param authority - Captured namespace authority
 */
export function assertScratchNamespaceAuthority(
  authority: ScratchNamespaceAuthority
): void {
  const current = scratchPathIdentity(authority.namespace.canonicalPath);
  if (
    current.dev !== authority.namespace.dev ||
    current.ino !== authority.namespace.ino ||
    current.canonicalPath !== authority.namespace.canonicalPath
  ) {
    throw new Error(
      "Scratch namespace identity changed after authority capture"
    );
  }
  const stat = fs.lstatSync(authority.namespace.canonicalPath);
  if ((stat.mode & 0o777) !== 0o700) {
    throw new Error("Scratch namespace mode changed after authority capture");
  }
  if (
    authority.namespace.uid !== undefined &&
    stat.uid !== authority.namespace.uid
  ) {
    throw new Error("Scratch namespace uid changed after authority capture");
  }
}

/**
 * Resolve authority for an existing exact namespace without creating it.
 * @param dir - Candidate exact namespace
 * @returns Captured authority, or undefined when absent
 */
function authorityForExistingNamespace(
  dir: string
): ScratchNamespaceAuthority | undefined {
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Scratch namespace must be a real directory: ${dir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (path.basename(dir) !== AUTHORIZED_SCRATCH_NAMESPACE) {
    throw new Error(
      `Scratch namespace must be the exact ${AUTHORIZED_SCRATCH_NAMESPACE} child`
    );
  }
  const authority = createScratchNamespaceAuthority(path.dirname(dir));
  if (fs.realpathSync(dir) !== authority.namespace.canonicalPath) {
    throw new Error(
      "Scratch namespace path does not match canonical authority"
    );
  }
  return authority;
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
 * Reclaim a recognized markerless legacy root only after its pid is dead.
 * @param authority - Pinned namespace authority
 * @param name - Direct child basename
 * @param legacyPid - Pid encoded in the recognized legacy name
 * @param options - Process probes
 * @returns Removal disposition
 */
function sweepMarkerlessLegacyEntry(
  authority: ScratchNamespaceAuthority,
  name: string,
  legacyPid: number,
  options: AuthorizedScratchSweepOptions
): "removed" | "kept" {
  if (options.isProcessAlive(legacyPid)) return "kept";
  removeAuthorizedScratchRoot({ authority, basename: name });
  return "removed";
}

/**
 * Judge one direct namespace entry without ever following a symlink.
 * @param authority - Pinned namespace authority
 * @param name - Direct child basename
 * @param options - Process probes and self name
 * @returns Removal disposition
 */
// One extra branch keeps all filesystem errors fail-closed at the authority boundary.
// eslint-disable-next-line sonarjs/cognitive-complexity -- fail-closed authority intentionally handles one extra branch
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
  const legacy = parseScratchRunRootName(name);
  const quarantine = name.startsWith(SCRATCH_QUARANTINE_PREFIX);
  if (legacy === undefined && !quarantine) return "kept";
  try {
    return sweepMarkedEntry(authority, name, root, quarantine, options);
  } catch (error) {
    if (
      legacy !== undefined &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return sweepMarkerlessLegacyEntry(authority, name, legacy.pid, options);
    }
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
  const authority = authorityForExistingNamespace(options.dir);
  if (authority === undefined) return { removed: [], kept: [] };
  return fs
    .readdirSync(authority.namespace.canonicalPath)
    .reduce(
      (result: AuthorizedScratchSweepResult, name) =>
        sweepAuthorizedEntry(authority, name, options) === "removed"
          ? { removed: [...result.removed, name], kept: result.kept }
          : { removed: result.removed, kept: [...result.kept, name] },
      { removed: [], kept: [] }
    );
}

/**
 * Demand one inert direct basename, never a path.
 * @param basename - Candidate direct child name
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

/** Exit status used when the child cwd does not match the expected inode. */
const BOUND_CLEANUP_IDENTITY_EXIT = 73;

/**
 * Synchronous deletion program whose cwd is bound by the kernel before it runs.
 *
 * Node exposes no portable `unlinkat(2)` API. A child cwd supplies equivalent
 * directory-handle authority on every Node platform: a rename after spawn does
 * not retarget `.`, while a rename before spawn fails the child's dev/ino check.
 * Recursive operations stay relative to that bound cwd and never follow a
 * final symlink.
 */
const BOUND_DIRECTORY_CLEANUP_PROGRAM = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const expectedDev = process.argv[1];
const expectedIno = process.argv[2];
const root = fs.lstatSync(".");
if (!root.isDirectory() || root.isSymbolicLink() || String(root.dev) !== expectedDev || String(root.ino) !== expectedIno) {
  process.stderr.write("scratch directory identity changed before bound cleanup\n");
  process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
}
const deadline = Date.now() + 30000;
const stack = fs.readdirSync(".").map(name => ({ candidate: name, depth: 1, visited: false }));
let entries = 0;
while (stack.length > 0) {
  if (Date.now() > deadline) throw new Error("scratch cleanup time bound exceeded");
  const item = stack.pop();
  entries += 1;
  if (entries > 100000) throw new Error("scratch cleanup entry bound exceeded");
  if (item.depth > 128) throw new Error("scratch cleanup depth bound exceeded");
  const stat = fs.lstatSync(item.candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fs.unlinkSync(item.candidate);
    continue;
  }
  if (item.visited) {
    fs.rmdirSync(item.candidate);
    continue;
  }
  stack.push({ ...item, visited: true });
  for (const child of fs.readdirSync(item.candidate)) {
    stack.push({ candidate: path.join(item.candidate, child), depth: item.depth + 1, visited: false });
  }
}
`;

/**
 * Clear a directory through a cwd bound to the inspected inode.
 * @param candidate - Directory to bind as the cleanup process cwd
 * @param expected - Identity captured before destructive work
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
    {
      cwd: candidate,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    }
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
 * Assert that an already-owned parent still resolves to its pinned identity.
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
 * Inspect a direct child only after its pinned parent passes revalidation.
 * @param options - Pinned parent and direct basename
 * @param child - Resolved direct child path
 * @returns Child lstat captured before a destructive operation
 */
function inspectAuthorizedScratchChild(
  options: RemoveAuthorizedScratchChildOptions,
  child: string
): fs.Stats {
  validateBasename(options.basename);
  assertScratchPathIdentity(options.parent);
  return fs.lstatSync(child);
}

/**
 * Remove one direct child while keeping recursive deletion bound to its inode.
 * @param options - Pinned parent and inert direct basename
 */
export function removeAuthorizedScratchChild(
  options: RemoveAuthorizedScratchChildOptions
): void {
  const child = path.join(options.parent.canonicalPath, options.basename);
  const stat = inspectAuthorizedScratchChild(options, child);
  options.afterIdentityCheck?.(child);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fs.unlinkSync(child);
  } else {
    clearDirectoryThroughBoundCwd(child, stat);
    fs.rmdirSync(child);
  }
  assertScratchPathIdentity(options.parent);
}

/**
 * Read one candidate without converting absence into an exception.
 * @param candidate - Direct candidate path
 * @returns Candidate stat, or undefined after an ENOENT race
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
 * Bind an optional armed inode identity to the inspected candidate.
 * @param options - Armed root authority
 * @param stat - Current candidate stat, or absence
 * @returns The unchanged current stat
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
 * @param options - Captured authority and basename
 * @param candidate - Resolved direct candidate path
 * @returns Candidate stat, or undefined after an ENOENT race
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
 * @param candidate - Owned root or quarantine path
 * @param expectedToken - Optional token captured with authority
 * @param phase - Diagnostic phase
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
 * @param quarantine - Same-namespace quarantine path
 * @param before - Original candidate identity
 * @param expectedToken - Optional marker token
 * @param afterIdentityCheck - Deterministic race probe run after inode capture
 * @returns Always true after removal
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
 * @param options - Authority, direct basename, and optional owner token
 * @returns True when removed, false when another process already removed it
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
/* eslint-enable max-lines -- end cohesive authority boundary */
