/** Canonical platform-temp namespace capture and immutable identity authority. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
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
 * Assert local namespace ownership without silently broadening authority.
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
  if ((stat.mode & 0o777) !== 0o700) {
    throw new Error(`Scratch namespace mode must be 0700: ${namespacePath}`);
  }
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
 * @returns Filesystem authority for its exact direct `lisa-scratch` child
 */
export function createScratchNamespaceAuthority(): ScratchNamespaceAuthority {
  const baseDir = os.tmpdir();
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
 * @returns Captured authority, or undefined when absent
 */
export function authorityForExistingScratchNamespace():
  | ScratchNamespaceAuthority
  | undefined {
  const dir = path.join(os.tmpdir(), AUTHORIZED_SCRATCH_NAMESPACE);
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
  const authority = createScratchNamespaceAuthority();
  if (fs.realpathSync(dir) !== authority.namespace.canonicalPath) {
    throw new Error(
      "Scratch namespace path does not match canonical authority"
    );
  }
  return authority;
}
