/**
 * @file ui-config-write-root-identity.ts
 * @description Portable fail-closed identity checks for UI config roots.
 *
 * Node exposes path-based filesystem calls but no portable `openat`/`renameat`
 * equivalents. A canonical realpath sandwich plus stable directory metadata is
 * therefore the strongest portable anchor available at each call boundary;
 * callers must still disclose the same-user race inside a final check-to-use
 * gap instead of claiming descriptor-relative protection.
 * @module cli/ui-config-write-root-identity
 */
import { lstat, realpath } from "node:fs/promises";
import * as path from "node:path";

/** Canonical path and stable metadata used to detect directory replacement. */
export interface ProjectRootIdentity {
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
  readonly mode: bigint;
  readonly uid: bigint;
  readonly gid: bigint;
}

/**
 * Capture and immediately revalidate an existing project directory.
 * @param projectRoot - Project path supplied by the UI server
 * @returns Canonical directory identity for all later transaction boundaries
 */
export async function requireCanonicalProjectRoot(
  projectRoot: string
): Promise<ProjectRootIdentity> {
  const canonical = await realpath(path.resolve(projectRoot));
  const metadata = await lstat(canonical, { bigint: true });
  if (!metadata.isDirectory()) {
    throw new Error("Config project root must be a directory");
  }
  const identity: ProjectRootIdentity = {
    path: canonical,
    dev: metadata.dev,
    ino: metadata.ino,
    birthtimeNs: metadata.birthtimeNs,
    mode: metadata.mode,
    uid: metadata.uid,
    gid: metadata.gid,
  };
  await assertProjectRootIdentity(identity);
  return identity;
}

/**
 * Revalidate the path against its initial directory identity. A realpath
 * sandwich catches ancestor redirection during metadata capture; stable
 * device/inode/birth/ownership metadata catches a byte-identical replacement
 * at the same canonical spelling.
 * @param expected - Identity captured before locking and file access
 */
export async function assertProjectRootIdentity(
  expected: ProjectRootIdentity
): Promise<void> {
  try {
    const canonicalBefore = await realpath(expected.path);
    const current = await lstat(expected.path, { bigint: true });
    const canonicalAfter = await realpath(expected.path);
    if (
      canonicalBefore !== expected.path ||
      canonicalAfter !== expected.path ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      current.birthtimeNs !== expected.birthtimeNs ||
      current.mode !== expected.mode ||
      current.uid !== expected.uid ||
      current.gid !== expected.gid
    ) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("Config project root changed during write");
  }
}
